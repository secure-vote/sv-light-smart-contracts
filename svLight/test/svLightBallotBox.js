var SVBallotBox = artifacts.require("./SVLightBallotBox.sol");

require("./testUtils")();

var naclJs = require("js-nacl");
var crypto = require("crypto");

const AsyncPar = require("async-parallel");

const { create, env } = require("sanctuary");
const S = create({ checkTypes: true, env });

const bytes32zero = "0x0000000000000000000000000000000000000000000000000000000000000000";

var hexSk = "0xcd9d715f05a4fce8acf3339fd5ee8549c1899c52e4b32da07cffcd91a29ad976";
var hexPk = "0xba781ed1006bd7694282a210485265f1c503f4e6721858b4269ae6d745f7bb4b";
var specHash = "0x418781fb172c2a30c072d58628f5df3f12052a0b785450fb0105f1b98b504561";

const mkStartTime = () => Math.round(Date.now() / 1000)
const mkFlags = ({useEnc, testing}) => [useEnc === true, testing === true];


async function testEarlyBallot(accounts) {
    var startTime = mkStartTime() + 2;
    var endTime = startTime + 600;

    const vc = await SVBallotBox.new(specHash, startTime, endTime, USE_ETH | USE_ENC | USE_TESTING);
    await assertErrStatus(ERR_BALLOT_CLOSED, await vc.submitBallotWithPk(hexPk, hexPk, { from: accounts[5] }), "should throw on early ballot");
}


async function testSetOwner(acc) {
    const start = mkStartTime() - 1;
    const vc = await SVBallotBox.new(specHash, start, start + 60, USE_ETH | USE_NO_ENC);
    const owner1 = await vc.owner();
    assert.equal(acc[0], owner1, "owner should be acc[0]");

    // fraud set owner
    await assert403(() => vc.setOwner(acc[2], {from: acc[1]}), "should throw if setOwner called by non-owner");

    // good set owner
    const soTxr = await vc.setOwner(acc[1]);
    assertNoErr(soTxr);
    const owner2 = await vc.owner();
    assert.equal(acc[1], owner2, "owner should change when legit req");
}


async function testEncryptionBranching(accounts) {
    var startTime = Math.floor(Date.now() / 1000) - 1;
    var endTime = startTime + 600;
    var shortEndTime = 0;

    /* ENCRYPTION */

    // best BB with enc
    const vcEnc = await SVBallotBox.new(specHash, startTime, endTime, USE_ETH | USE_ENC | USE_TESTING);

    // check we're using enc
    assert.equal(await vcEnc.submissionBits(), USE_ETH | USE_ENC | USE_TESTING, "encryption should be enabled");

    // check submissions with enc
    const bData = hexPk;
    assertErrStatus(ERR_NOT_BALLOT_ETH_NO_ENC, await vcEnc.submitBallotNoPk(bData), "throw when not using encryption");
    assert.equal(await vcEnc.nVotesCast(), 0, "no votes yet");

    const tempPk = specHash;
    const _wEnc = await vcEnc.submitBallotWithPk(bData, tempPk);
    assertNoErr(_wEnc);
    assert.equal(await vcEnc.nVotesCast(), 1, "1 vote");
    assertOnlyEvent("SuccessfulVote", _wEnc);
    const ballot = await vcEnc.ballotMap(0);
    const blockN = await (mkPromise(web3.eth.getBlockNumber)());
    assert.equal(ballot[0], bData, "ballot data stored");
    assert.equal(bytes32AddrToAddr(ballot[1]), accounts[0], "voter stored correctly");
    assert.equal(ballot[2].toNumber(), blockN, "blockN matches expected");
    assert.equal(await vcEnc.curve25519Pubkeys(0), tempPk, "pk stored matches");

    /* NO ENCRYPTION */

    // create ballot box with no enc
    const vcNoEnc = await SVBallotBox.new(specHash, startTime, endTime, USE_ETH | USE_NO_ENC | USE_TESTING);

    // assert useEnc is false with no enc
    assert.equal(await vcNoEnc.submissionBits(), USE_ETH | USE_NO_ENC | USE_TESTING, "encryption should be disabled");
    // test ballot submissions w no enc
    const _bData = hexSk;
    const _noEnc = await vcNoEnc.submitBallotNoPk(_bData);
    assertNoErr(_noEnc);
    assertOnlyEvent("SuccessfulVote", _noEnc);
    const _bReturned = await vcNoEnc.ballotMap(0);
    assert.equal(_bReturned[0], _bData, "ballot data matches");
    assert.equal(bytes32AddrToAddr(_bReturned[1]), accounts[0], "voter acc matches")
    assert.equal(await vcNoEnc.curve25519Pubkeys(0), bytes32zero, "pubkey is zero");

    assert.equal(await vcEnc.nVotesCast(), 1, "1 vote");
    assertErrStatus(ERR_NOT_BALLOT_ETH_WITH_ENC, await vcNoEnc.submitBallotWithPk(hexSk, hexSk), "should throw with enc disabled");
    assert.equal(await vcEnc.nVotesCast(), 1, "still only 1 vote");

    /* NO ENC SIGNED */

    vcSignedNoEnc = await SVBallotBox.new(specHash, startTime, endTime, USE_SIGNED | USE_NO_ENC | USE_TESTING);

    const _txSignedNoEnc = await vcSignedNoEnc.submitBallotSignedNoEnc(_bData, tempPk, [tempPk, tempPk]);
    assertNoErr(_txSignedNoEnc);

    const _txSignedNoEncBad = await vcSignedNoEnc.submitBallotSignedWithEnc(_bData, tempPk, tempPk, [tempPk, tempPk]);
    assertErrStatus(ERR_NOT_BALLOT_SIGNED_WITH_ENC, _txSignedNoEncBad, "should throw when submitting signed w/ enc when no_enc");
    assertErrStatus(ERR_NOT_BALLOT_ETH_WITH_ENC, await vcSignedNoEnc.submitBallotWithPk(_bData, tempPk), "should throw when submitting eth w/ enc when enc no_enc");

    /* ENC SIGNED */

    vcSigned = await SVBallotBox.new(specHash, startTime, endTime, USE_SIGNED | USE_ENC | USE_TESTING);

    const _tx5o1 = await vcSigned.submitBallotSignedNoEnc(_bData, tempPk, [tempPk, tempPk]);
    assertErrStatus(ERR_NOT_BALLOT_SIGNED_NO_ENC, _tx5o1, "should throw when submitting signed no enc when enc enabled");

    const _tx5o2 = await vcSigned.submitBallotSignedWithEnc(_bData, tempPk, tempPk, [tempPk, tempPk]);
    assertNoErr(_txSignedNoEnc);
}

async function testInstantiation(accounts) {
    var startTime = Math.floor(Date.now() / 1000) - 1;
    var endTime = startTime + 600;
    var shortEndTime = 0;

    const vc = await SVBallotBox.new(specHash, startTime, endTime, USE_ETH | USE_ENC | USE_TESTING);

    // log(accounts[0]);
    assert.equal(await vc.owner(), accounts[0], "Owner must be set on launch.");

    assert.equal(await vc.specHash(), specHash, "specHash should be equal");

    const _startTime = await vc.startTime();
    assert.equal(startTime, _startTime.toNumber(), "startTime matches");

    const _endTime = await vc.endTime();
    assert.equal(endTime, _endTime.toNumber(), "endTime matches");

    const _testMode = await vc.isTesting();
    assert.equal(_testMode, true, "We should be in test mode");

    const _nVotes = await vc.nVotesCast();
    assert.equal(_nVotes.toNumber(), 0, "Should have no votes at start");

    const _sk = await vc.ballotEncryptionSeckey();
    assert.equal(_sk, bytes32zero, "ballot enc key should be zeros before reveal");

    //// ASSERTIONS FOR INSTANTIATION COMPLETE

    // wait a second so we don't hit the startTime requirement
    await (new Promise((resolve, reject) => { setTimeout(resolve, (startTime * 1000 + 1) - Date.now()) }));

    // try a single ballot first
    await testABallot(accounts)(S.Just(vc), S.Just(accounts[0]), "test ballot single");

    const nVotes = 10;
    try {
        // now a bunch
        await AsyncPar.map(S.range(0, nVotes), async i => {
            return await testABallot(accounts)(S.Just(vc), S.Just(accounts[i]), "test ballot batch: " + i.toString());
        });
        // Woot, tested 98 ballots.
    } catch (err) {
        console.log(err.message);
        for (var item of err.list) {
            console.log(item.message);
        }
        throw err;
    }

    assert.equal((await vc.nVotesCast()).toNumber(), nVotes + 1, "should have cast " + (nVotes + 1).toString() + " votes thus far");

    assertErrStatus(ERR_EARLY_SECKEY, await vc.revealSeckey(hexSk), "should throw on early reveal");

    // jump to after ballot is closed
    // note: originally used testrpc's evm_increaseTime RPC call, but you can't go backwards or undo, so it screws up other test 👿
    _setTxR = await vc.setEndTime(0);
    assertNoErr(_setTxR)

    await assert403(() => vc.revealSeckey(hexSk, { from: accounts[4] }), "cannot reveal seckey from non-admin");

    const _revealSK = await vc.revealSeckey(hexSk);
    assertOnlyEvent("SeckeyRevealed", _revealSK);
    assertNoErr(_revealSK);

    assertErrStatus(ERR_BALLOT_CLOSED, await vc.submitBallotWithPk(hexPk, hexPk, { from: accounts[4] }), "late ballot throws");
}

async function testTestMode(accounts) {
    var vc = await SVBallotBox.new(specHash, 0, 1, USE_ETH | USE_NO_ENC);
    assertErrStatus(ERR_TESTING_REQ, await vc.setEndTime(0), "throws on set end time when not in testing");
}

const testABallot = accounts => async (_vc = S.Nothing, account = S.Nothing, msg = "no message provided") => {
    if (S.isNothing(_vc)) {
        throw Error("must provide voting contract to `testABallot`");
    }
    const vc = S.fromMaybe_(() => null, _vc);
    const myAddr = S.fromMaybe(accounts[0], account);

    const encBallot = genRandomBytes32();
    const vtrPubkey = genRandomBytes32();

    const _submitBallotWithPk = await asyncAssertDoesNotThrow(() => vc.submitBallotWithPk(encBallot, vtrPubkey, {
        from: myAddr
    }), msg);
    assertOnlyEvent("SuccessfulVote", _submitBallotWithPk);
    assertNoErr(_submitBallotWithPk);
    const {args} = getEventFromTxR("SuccessfulVote", _submitBallotWithPk);
    const {ballotId: _ballotId} = args;

    // const _nVotesRet = await vc.nVotesCast();
    const _pkRet = await vc.curve25519Pubkeys(_ballotId);
    const [_ballotRet, _addr, _blockN] = await vc.ballotMap(_ballotId);

    // note: these two tests do not work in parallel - disabled
    // assert.equal(_nVotesRet.toNumber(), expectedVotes, "should have " + expectedVotes.toString() + " vote");
    // assert.equal(_ballotId.toNumber(), expectedVotes - 1, "should be " + (expectedVotes - 1) + "th ballot");
    assert.equal(bytes32AddrToAddr(_addr), myAddr, "account should match");
    assert.equal(_pkRet, vtrPubkey, "pubkey should match");
    assert.equal(_ballotRet, encBallot, "ballots should match");

    return true;
};

function sAssertEq(a, b, msg) {
    return assert.true(S.equals(a, b), msg);
}

async function timeTravel(seconds) {
    const response = web3.currentProvider.send({
        jsonrpc: "2.0",
        method: "evm_increaseTime",
        params: [seconds],
        id: 0
    });
    console.log("Time travelled " + seconds + " seconds; new offset: " + response.result);
    return response.result;
}

async function getSnapshot() {
    const resp = await web3.currentProvider.send({
        jsonrpc: "2.0",
        method: "evm_snapshot",
        params: [],
        id: 0
    });
    return resp.result;
}

async function testrpcRevert(snapshot) {
    const args = snapshot ? [snapshot] : [];
    return await web3.currentProvider.send({
        jsonrpc: "2.0",
        method: "evm_revert",
        params: args,
        id: 0
    });
}

contract("LittleBallotBox", function(_accounts) {
    it("should instantiate correctly", wrapTest(_accounts, testInstantiation));
    it("should allow setting owner", wrapTest(_accounts, testSetOwner));
    it("should enforce encryption based on PK submitted", wrapTest(_accounts, testEncryptionBranching));
    it("should not allow testing functions if testing mode is false", wrapTest(_accounts, testTestMode));
    it("should throw on early ballot", wrapTest(_accounts, testEarlyBallot));
});
