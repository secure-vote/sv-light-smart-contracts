var SVBallotBox = artifacts.require("./SVLightBallotBox");
var BBInstance = artifacts.require("./BBInstance")
var EmitterTesting = artifacts.require("./EmitterTesting");
var SvIndex = artifacts.require("./SVLightIndex");
var SvPayments = artifacts.require("./SVPayments");
var BallotAux = artifacts.require("./BallotAux");

require("./testUtils")();

var naclJs = require("js-nacl");
var crypto = require("crypto");

const R = require('ramda')

const AsyncPar = require("async-parallel");

const { create, env } = require("sanctuary");
const S = create({ checkTypes: true, env });

const bytes32zero = "0x0000000000000000000000000000000000000000000000000000000000000000";

var hexSk = "0xcd9d715f05a4fce8acf3339fd5ee8549c1899c52e4b32da07cffcd91a29ad976";
var hexPk = "0xba781ed1006bd7694282a210485265f1c503f4e6721858b4269ae6d745f7bb4b";
var specHash = "0x418781fb172c2a30c072d58628f5df3f12052a0b785450fb0105f1b98b504561";

const mkStartTime = () => Math.round(Date.now() / 1000)
const mkFlags = ({useEnc, testing}) => [useEnc === true, testing === true];

const genStdPacked = () => {
    const [s,e] = genStartEndTimes();
    const p = mkPacked(s, e, USE_ETH | USE_NO_ENC);
    return toBigNumber(p);
}

const genStdBB = async BB => {
    return await BB.new(genRandomBytes32(), genStdPacked(), zeroAddr);
}

const mkBBPx = (bb, bbaux) => new Proxy(bbaux, {
        get: (obj, method) =>
            async (...args) =>
                await bbaux[method](bb.address, ...args)
    })


async function testEarlyBallot({accounts, BB}) {
    var startTime = mkStartTime() + 2;
    var endTime = startTime + 600;

    const vc = await BB.new(specHash, mkPacked(startTime, endTime, USE_ETH | USE_ENC | USE_TESTING), zeroAddr);
    await assertErrStatus(ERR_BALLOT_CLOSED, vc.submitBallotWithPk(hexPk, hexPk, { from: accounts[5] }), "should throw on early ballot");
}


async function testSetOwner({accounts, BB}) {
    const acc = accounts;
    const start = mkStartTime() - 1;
    const vc = await BB.new(specHash, mkPacked(start, start + 60, USE_ETH | USE_NO_ENC), zeroAddr);
    const owner1 = await vc.owner();
    assert.equal(acc[0], owner1, "owner should be acc[0]");

    // fraud set owner
    await assert403(vc.setOwner(acc[2], {from: acc[1]}), "should throw if setOwner called by non-owner");

    // good set owner
    const soTxr = await vc.setOwner(acc[1]);
    assertNoErr(soTxr);
    const owner2 = await vc.owner();
    assert.equal(acc[1], owner2, "owner should change when legit req");
}


async function testEncryptionBranching({accounts, BB, bbaux}) {
    var startTime = Math.floor(Date.now() / 1000) - 1;
    var endTime = startTime + 600;
    var shortEndTime = 0;


    /* ENCRYPTION */

    // best BB with enc
    const vcEnc = await BB.new(specHash, mkPacked(startTime, endTime, USE_ETH | USE_ENC | USE_TESTING), zeroAddr);

    const aux = mkBBPx(vcEnc, bbaux);

    // check we're using enc
    assert.equal(await aux.getSubmissionBits(), USE_ETH | USE_ENC | USE_TESTING, "encryption should be enabled");

    // check submissions with enc
    const bData = hexPk;
    await assertErrStatus(ERR_NOT_BALLOT_ETH_NO_ENC, vcEnc.submitBallotNoPk(bData), "throw when not using encryption");
    assert.equal(await aux.getNVotesCast(), 0, "no votes yet");

    const tempPk = specHash;
    const _wEnc = await vcEnc.submitBallotWithPk(bData, tempPk);
    assertNoErr(_wEnc);
    assert.equal(await aux.getNVotesCast(), 1, "1 vote");
    assertOnlyEvent("SuccessfulVote", _wEnc);
    const ballot = await vcEnc.getBallotEth(0);
    assert.equal(ballot[0], bData, "ballot data stored");
    assert.equal(ballot[1], accounts[0], "voter stored correctly");
    assert.equal(await vcEnc.getPubkey(0), tempPk, "pk stored matches");

    /* NO ENCRYPTION */

    // create ballot box with no enc
    const vcNoEnc = await BB.new(specHash, mkPacked(startTime, endTime, USE_ETH | USE_NO_ENC | USE_TESTING), zeroAddr);
    const auxNoEnc = mkBBPx(vcNoEnc, bbaux);

    // assert useEnc is false with no enc
    assert.equal(await auxNoEnc.getSubmissionBits(), USE_ETH | USE_NO_ENC | USE_TESTING, "encryption should be disabled");
    // test ballot submissions w no enc
    const _bData = hexSk;
    const _noEnc = await vcNoEnc.submitBallotNoPk(_bData);
    assertNoErr(_noEnc);
    assertOnlyEvent("SuccessfulVote", _noEnc);
    const _bReturned = await vcNoEnc.getBallotEth(0);
    assert.equal(_bReturned[0], _bData, "ballot data matches");
    assert.equal(_bReturned[1], accounts[0], "voter acc matches")
    assert.equal(await vcNoEnc.getPubkey(0), bytes32zero, "pubkey is zero");

    assert.equal(await auxNoEnc.getNVotesCast(), 1, "1 vote");
    await assertErrStatus(ERR_NOT_BALLOT_ETH_WITH_ENC, vcNoEnc.submitBallotWithPk(hexSk, hexSk), "should throw with enc disabled");
    assert.equal(await auxNoEnc.getNVotesCast(), 1, "still only 1 vote");

    // /* NO ENC SIGNED */

    // vcSignedNoEnc = await BB.new(specHash, mkPacked(startTime, endTime, USE_SIGNED | USE_NO_ENC | USE_TESTING), zeroAddr);

    // const _txSignedNoEnc = await vcSignedNoEnc.submitBallotSignedNoEnc(_bData, tempPk, [tempPk, tempPk]);
    // assertNoErr(_txSignedNoEnc);

    // await assertErrStatus(ERR_NOT_BALLOT_SIGNED_WITH_ENC,
    //     vcSignedNoEnc.submitBallotSignedWithEnc(_bData, tempPk, tempPk, [tempPk, tempPk]),
    //     "should throw when submitting signed w/ enc when no_enc");
    // await assertErrStatus(ERR_NOT_BALLOT_ETH_WITH_ENC,
    //     vcSignedNoEnc.submitBallotWithPk(_bData, tempPk),
    //     "should throw when submitting eth w/ enc when enc no_enc");

    // /* ENC SIGNED */

    // vcSigned = await BB.new(specHash, mkPacked(startTime, endTime, USE_SIGNED | USE_ENC | USE_TESTING), zeroAddr);

    // await assertErrStatus(ERR_NOT_BALLOT_SIGNED_NO_ENC,
    //     vcSigned.submitBallotSignedNoEnc(_bData, tempPk, [tempPk, tempPk]),
    //     "should throw when submitting signed no enc when enc enabled");

    // const _tx5o2 = await vcSigned.submitBallotSignedWithEnc(_bData, tempPk, tempPk, [tempPk, tempPk]);
    // assertNoErr(_tx5o2);
}

async function testInstantiation({accounts, BB, bbaux}) {
    var startTime = Math.floor(Date.now() / 1000) - 1;
    var endTime = startTime + 600;
    var shortEndTime = 0;

    const vc = await BB.new(specHash, mkPacked(startTime, endTime, USE_ETH | USE_ENC | USE_TESTING), zeroAddr);

    const aux = mkBBPx(vc, bbaux);

    // log(accounts[0]);
    assert.equal(await vc.owner(), accounts[0], "Owner must be set on launch.");

    assert.equal(await aux.getSpecHash(), specHash, "specHash should be equal");

    const _startTime = await aux.getStartTime();
    assert.equal(startTime, _startTime.toNumber(), "startTime matches");

    const _endTime = await aux.getEndTime();
    assert.equal(endTime, _endTime.toNumber(), "endTime matches");

    const _testMode = await aux.isTesting();
    assert.equal(_testMode, true, "We should be in test mode");

    assert.equal(await aux.isOfficial(), false, "isOfficial should be false atm");
    assert.equal(await aux.isBinding(), false, "isBinding should be false atm");

    const _nVotes = await aux.getNVotesCast();
    assert.equal(_nVotes.toNumber(), 0, "Should have no votes at start");

    const _sk = await aux.getEncSeckey();
    assert.equal(_sk, bytes32zero, "ballot enc key should be zeros before reveal");

    //// ASSERTIONS FOR INSTANTIATION COMPLETE

    // wait a second so we don't hit the startTime requirement
    await (new Promise((resolve, reject) => { setTimeout(resolve, (startTime * 1000 + 1) - Date.now()) }));

    // try a single ballot first
    await testABallot(accounts)(S.Just(vc), S.Just(accounts[0]), "test ballot single");
    assert.equal(await aux.hasVoted(accounts[0]), true, "hasVotedEth method should work.");

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

    assert.equal((await aux.getNVotesCast()).toNumber(), nVotes + 1, "should have cast " + (nVotes + 1).toString() + " votes thus far");

    await assertErrStatus(ERR_EARLY_SECKEY, vc.revealSeckey(hexSk), "should throw on early reveal");

    // jump to after ballot is closed
    // note: originally used testrpc's evm_increaseTime RPC call, but you can't go backwards or undo, so it screws up other test 👿
    _setTxR = await vc.setEndTime(0);
    assertNoErr(_setTxR)

    await assert403(vc.revealSeckey(hexSk, { from: accounts[4] }), "cannot reveal seckey from non-admin");

    const _revealSK = await vc.revealSeckey(hexSk);
    assertOnlyEvent("SeckeyRevealed", _revealSK);
    assertNoErr(_revealSK);
    assert.equal(await aux.getEncSeckey(), hexSk, "secret key should match");

    await assertErrStatus(ERR_BALLOT_CLOSED, vc.submitBallotWithPk(hexPk, hexPk, { from: accounts[4] }), "late ballot throws");
}


async function testTestMode({accounts, BB, bbaux}) {
    var vc = await BB.new(specHash, mkPacked(0, 1, USE_ETH | USE_NO_ENC), zeroAddr);
    await assertErrStatus(ERR_TESTING_REQ, vc.setEndTime(0), "throws on set end time when not in testing");
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

    // const _nVotesRet = await vc.getNVotesCast();
    const _pkRet = await vc.getPubkey(_ballotId);
    const [_ballotRet, _addr] = await vc.getBallotEth(_ballotId);

    // note: these two tests do not work in parallel - disabled
    // assert.equal(_nVotesRet.toNumber(), expectedVotes, "should have " + expectedVotes.toString() + " vote");
    // assert.equal(_ballotId.toNumber(), expectedVotes - 1, "should be " + (expectedVotes - 1) + "th ballot");
    assert.equal(_addr, myAddr, "account should match");
    assert.equal(_pkRet, vtrPubkey, "pubkey should match");
    assert.equal(_ballotRet, encBallot, "ballots should match");

    return true;
};


const _genSigned = () => {
    return {
        ballot: genRandomBytes32(),
        edPk: genRandomBytes32(),
        sig: [genRandomBytes32(), genRandomBytes32()],
        curvePk: genRandomBytes32()
    }
}


// async function testSignedBallotNoEnc({accounts, log, BB}){
//     const [startTime, endTime] = genStartEndTimes();
//     const bb = await BB.new(specHash, mkPacked(startTime, endTime, USE_SIGNED | USE_NO_ENC | USE_TESTING), zeroAddr);

//     assert.equal((await bb.getStartTime()).toNumber(), startTime, "start times match");

//     b1 = _genSigned();

//     const tx1o1 = await bb.submitBallotSignedNoEnc(b1.ballot, b1.edPk, b1.sig);
//     assertNoErr(tx1o1);
//     const {args: _v1o1} = getEventFromTxR("SuccessfulVote", tx1o1);
//     assert.equal(_v1o1.voter, b1.edPk, "voter pk should match");

//     await log("voter matches 1")

//     const _r1o1 = {};
//     _r1o1.ballot = await bb.getBallotSigned(_v1o1.ballotId).then(([b]) => b);
//     assert.deepEqual(_r1o1.ballot, b1.ballot, "ballots should match");
//     await log("ballot matches 1")

//     _r1o1.sig = await bb.getSignature(_v1o1.ballotId);
//     assert.deepEqual(_r1o1.sig, b1.sig, "sigs should match");
//     await log("edSig matches 1")


//     await assertErrStatus(ERR_NOT_BALLOT_ETH_NO_ENC, bb.submitBallotNoPk(b1.ballot));
//     await assertErrStatus(ERR_NOT_BALLOT_ETH_WITH_ENC, bb.submitBallotWithPk(b1.ballot, b1.edPk));
//     await assertErrStatus(ERR_NOT_BALLOT_SIGNED_WITH_ENC, bb.submitBallotSignedWithEnc(b1.ballot, b1.curvePk, b1.edPk, b1.sig));
// }


// async function testSignedBallotWithEnc({accounts, log, BB}){
//     const [startTime, endTime] = genStartEndTimes();
//     const bb = await BB.new(specHash, mkPacked(startTime, endTime, USE_SIGNED | USE_ENC | USE_TESTING), zeroAddr);

//     assert.equal((await bb.getStartTime()).toNumber(), startTime, "start times match");

//     b1 = _genSigned();

//     const tx1o1 = await bb.submitBallotSignedWithEnc(b1.ballot, b1.curvePk, b1.edPk, b1.sig);
//     assertNoErr(tx1o1);
//     const {args: _v1o1} = getEventFromTxR("SuccessfulVote", tx1o1);
//     assert.equal(_v1o1.voter, b1.edPk, "voter pk should match");

//     await log("voter matches 1")

//     const _r1o1 = {};
//     _r1o1.sig = await bb.getSignature(_v1o1.ballotId);
//     assert.deepEqual(_r1o1.sig, b1.sig, "sigs should match");
//     await log('edsig match 1')

//     _r1o1.ballot = await bb.getBallotSigned(_v1o1.ballotId).then(([b]) => b);
//     assert.deepEqual(_r1o1.ballot, b1.ballot, "ballots should match");
//     await log('ballot match 1')

//     _r1o1.curvePk = await bb.getPubkey(_v1o1.ballotId);
//     assert.equal(_r1o1.curvePk, b1.curvePk, "curvePks should match");

//     await assertErrStatus(ERR_NOT_BALLOT_ETH_NO_ENC, bb.submitBallotNoPk(b1.ballot));
//     await assertErrStatus(ERR_NOT_BALLOT_ETH_WITH_ENC, bb.submitBallotWithPk(b1.ballot, b1.edPk));
//     await assertErrStatus(ERR_NOT_BALLOT_SIGNED_NO_ENC, bb.submitBallotSignedNoEnc(b1.ballot, b1.edPk, b1.sig));
// }


async function testDeprecation({accounts, BB, bbaux}) {
    const [startTime, endTime] = genStartEndTimes();
    const bb = await BB.new(specHash, toBigNumber(mkPacked(startTime, endTime, USE_ETH | USE_NO_ENC | USE_TESTING)), zeroAddr);
    const aux = mkBBPx(bb, bbaux);

    assert.equal(await aux.isDeprecated(), false, "should not be deprecated");
    await bb.setDeprecated();
    assert.equal(await aux.isDeprecated(), true, "should be deprecated");

    await assertRevert(bb.submitBallotNoPk(genRandomBytes32()), "submit ballot should throw after deprecation");
}


const testVersion = async ({BB, bbaux}) => {
    const [startTime, endTime] = genStartEndTimes();
    const bb = await BB.new(specHash, mkPacked(startTime + 10, endTime, USE_ETH | USE_ENC), zeroAddr);
    assert.equal(await bb.getVersion(), 3, "version should be 3");
}


const testSponsorship = async ({accounts, BB, bbaux}) => {
    const [startTime, endTime] = genStartEndTimes();
    const payments = await SvPayments.new(accounts[9]);
    const ix = await SvIndex.new(zeroAddr, payments.address, zeroAddr, zeroAddr, zeroAddr, zeroAddr);
    const bb = await BB.new(specHash, mkPacked(startTime, endTime, USE_ETH | USE_ENC | USE_TESTING), ix.address);

    assert.deepEqual(toBigNumber(0), await bb.getTotalSponsorship(), "sponsorship should be 0 atm");

    const balPre = await getBalance(accounts[0]);
    await bb.sendTransaction({
        from: accounts[1],
        value: toBigNumber(oneEth)
    });
    const balPost = await getBalance(accounts[0]);
    assert.deepEqual(balPost, toBigNumber(oneEth).plus(balPre), "sponsorship balance (payTo) should match expected");

    assert.deepEqual(await bb.getTotalSponsorship(), toBigNumber(oneEth), "getTotalSponsorship should match expected");
}


const testBadSubmissionBits = async ({accounts, BB, bbaux}) => {
    const [s, e] = genStartEndTimes();

    const flags = [USE_ENC, USE_NO_ENC];
    // const flagCombos = R.map(f => R.reduce((acc, i) => {
    //     return acc | i;
    // }, 0, R.without([f], flags)), flags);
    const badPacked1 = [toBigNumber(mkPacked(s, e, USE_ETH | USE_ENC | USE_NO_ENC))];
    const badPacked2 = [toBigNumber(mkPacked(s, e, USE_ETH))];

    await Promise.all(R.map(p => {
        return assertRevert(BB.new(specHash, p, zeroAddr), "bad submission bits (conflicting) should fail");
    }, badPacked1));

    await Promise.all(R.map(p => {
        return assertRevert(BB.new(specHash, p, zeroAddr), "bad submission bits (not enough) should fail");
    }, badPacked2));

    await assertRevert(BB.new(specHash, toBigNumber(mkPacked(s, e, 32 | USE_ETH | USE_ENC)), zeroAddr), "sub bits in middle banned");
    // make sure the ballot works excluding the `32` in subBits above
    await BB.new(specHash, toBigNumber(mkPacked(s, e, USE_ETH | USE_ENC)), zeroAddr);
    await assertRevert(BB.new(specHash, toBigNumber(mkPacked(s, e, USE_SIGNED | USE_ENC)), zeroAddr), "no signed ballots");
}


const testCommStatus = async ({accounts, BB, bbaux, bbName}) => {
    const [s,e] = genStartEndTimes();

    const std = USE_ETH | USE_NO_ENC;
    const goodBits = [
        std,
    ]

    const badBits = [
        std | IS_OFFICIAL,
        std | IS_BINDING,
        std | IS_OFFICIAL | IS_BINDING,
        USE_ETH | USE_ENC,
    ]

    // console.log(bbName, goodBits, badBits)

    const goodPacked = R.map(b => mkPacked(s,e,b), goodBits)
    const badPacked = R.map(b => mkPacked(s,e,b), badBits)

    await Promise.all(R.map(async p => {
        const specHash = genRandomBytes32();
        const bb = await BB.new(specHash, toBigNumber(p), zeroAddr);
        // console.log('good', bbName, specHash.slice(0,8), p.toString(16), (await bbaux.getSubmissionBits(bb.address)).toString(2), await bbaux.qualifiesAsCommunityBallot(bb.address))
        assert.equal(await bbaux.qualifiesAsCommunityBallot(bb.address), true, `${bbName} Ballot with packed ${p} should qualify as comm`)
    }, goodPacked))

    await Promise.all(R.map(async p => {
        const specHash = genRandomBytes32();
        const bb = await BB.new(specHash, toBigNumber(p), zeroAddr);
        // console.log('bad', bbName, specHash.slice(0,8), p.toString(16), (await bbaux.getSubmissionBits(bb.address)).toString(2), await bbaux.qualifiesAsCommunityBallot(bb.address))
        assert.equal(await bbaux.qualifiesAsCommunityBallot(bb.address), false, `${bbName} Ballot with packed ${p} should not qualify as community ballot`)
    }, badPacked));
}


const testOwner = async ({accounts, BB, bbaux}) => {
    const bb = await genStdBB(BB);
    assert.equal(await bb.owner(), accounts[0], "owner should be as expected");

    await bb.setOwner(accounts[1], {from: accounts[0]});
    assert.equal(await bb.owner(), accounts[1], "owner should be as expected after update");

    await assertRevert(bb.setOwner(accounts[2], {from: accounts[0]}), "setOwner permissions okay");
}


const testGetVotes = async ({accounts, BB, bbaux}) => {
    const [s, e] = genStartEndTimes();

    const zeroSig = [bytes32zero, bytes32zero]
    const testSig1 = [genRandomBytes32(), genRandomBytes32()];
    const testSig2 = [genRandomBytes32(), genRandomBytes32()];

    const _ballot1 = genRandomBytes32();
    const _ballot2 = genRandomBytes32();

    const _pk1 = genRandomBytes32();
    const _pk2 = genRandomBytes32();

    const bbNoEnc = await BB.new(specHash, mkPacked(s, e, (USE_ETH | USE_NO_ENC)), zeroAddr);
    const bbEnc = await BB.new(specHash, mkPacked(s, e, (USE_ETH | USE_ENC)), zeroAddr);

    const getBallotsTest = async (bb, useEnc) => {
        const aux = mkBBPx(bb, bbaux);

        // test getBallotsEthFrom
        assert.deepEqual(await aux.getBallotsFrom(accounts[0]), [[], [], []], "getBallotsFrom should be empty before any votes");
        assert.deepEqual(await aux.getBallots(), [[], []], "getBallots should be empty before any votes");

        if (useEnc) {
            await bb.submitBallotWithPk(_ballot1, _pk1, {from: accounts[0]});
            await bb.submitBallotWithPk(_ballot2, _pk2, {from: accounts[1]});
        } else {
            await bb.submitBallotNoPk(_ballot1, {from: accounts[0]});
            await bb.submitBallotNoPk(_ballot2, {from: accounts[1]});
        }

        const getVotesA1Post = await aux.getBallotsFrom(accounts[0]);
        const getVotesPost = await aux.getBallots();

        assert.deepEqual(getVotesA1Post,
                [ [toBigNumber(0)]
                , [_ballot1]
                , useEnc ? [_pk1] : [bytes32zero]
            ], "getBallotsFrom (a0) should match expected");

        assert.deepEqual(await aux.getBallotsFrom(accounts[1]),
                [ [toBigNumber(1)]
                , [_ballot2]
                , useEnc ? [_pk2] : [bytes32zero]
            ], "getBallotsFrom (a0) should match expected");

        assert.deepEqual(getVotesPost,
            [ [_ballot1, _ballot2]
            , useEnc ? [_pk1, _pk2] : [bytes32zero, bytes32zero]
            ], "getBallots should match")
    }

    await getBallotsTest(bbNoEnc, false);
    await getBallotsTest(bbEnc, true);
}


const initGasComparison = async ({accounts}) => {
    const u = accounts[0];

    const b1 = await getBalance(u);

    await genStdBB(SVBallotBox);

    const b2 = await getBalance(u);

    await genStdBB(BBInstance);

    const b3 = await getBalance(u);

    const g1 = b1.minus(b2);
    const g2 = b2.minus(b3);

    console.log(`Gas for SVBallotBox: ${g1.toFixed()}`)
    console.log(`Gas for  BBInstance: ${g2.toFixed()}`)

    assert.equal(g1.gt(g2), true, "gas for SVBallotBox should be greater than for BBInstance (which uses a library)")
}


function sAssertEq(a, b, msg) {
    return assert.true(S.equals(a, b), msg);
}


const _wrapTest = ({accounts, BB, bbName}, f) => {
    return async () => {
        const Emitter = await EmitterTesting.new();
        const log = m => Emitter.log(m);
        const bbaux = await BallotAux.new();
        return await f({accounts, BB, log, bbaux, bbName});
    };
}


contract("BallotBox", function(accounts) {
    // we want to replicate tests between SVLightBallotBox and BBInstance.
    // we do this by wrapping every test and prefixing it, then running them
    // and passing in the contract instance as a variable. We also prepend the
    // test description to note the differences.

    const tests = [
        ["should instantiate correctly", testInstantiation],
        ["should allow setting owner", testSetOwner],
        ["should enforce encryption based on PK submitted", testEncryptionBranching],
        ["should not allow testing functions if testing mode is false", testTestMode],
        ["should throw on early ballot", testEarlyBallot],
        // ["should handle signed ballots", testSignedBallotNoEnc],
        // ["should handle signed ballots with enc", testSignedBallotWithEnc],
        ["should allow deprecation", testDeprecation],
        ["should have correct version", testVersion],
        ["test sponsorship", testSponsorship],
        ["test bad submission bits", testBadSubmissionBits],
        ["test getBallots*From", testGetVotes],
        ["test community status", testCommStatus],
        ["test owner", testOwner],
    ]
    S.map(([desc, f]) => {
        it("Std BB: " + desc, _wrapTest({accounts, BB: SVBallotBox, bbName: "Std"}, f))
        it("Lib BB: " + desc, _wrapTest({accounts, BB: BBInstance, bbName: "Lib"}, f))
    }, tests);

    it("Init gas comparison", async () => await initGasComparison({accounts}));
});
