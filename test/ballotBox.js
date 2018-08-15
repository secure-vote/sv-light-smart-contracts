var EmitterTesting = artifacts.require("./EmitterTesting");
var SvIndex = artifacts.require("./SVIndex");
var SvPayments = artifacts.require("./SVPayments");
var BallotAux = artifacts.require("./BallotAux");
var BBFarm = artifacts.require("./BBFarm")
var BBFarmPx = artifacts.require("./BBFarmProxy")
var BBFarmAux = artifacts.require("./BBFarmAux")
var BBFarmAux2 = artifacts.require("./BBFarmAux2")
var TestHelper = artifacts.require("./TestHelper")

require("./testUtils")();

const naclJs = require("js-nacl")
const crypto = require("crypto")
const { mkSignedBallotForProxy } = require("sv-lib/lib/ballotBox")
const Account = require("eth-lib/lib/account")

const R = require('ramda')

const AsyncPar = require("async-parallel");

const { create, env } = require("sanctuary");
const S = create({ checkTypes: true, env });

const bytes32zero = "0x0000000000000000000000000000000000000000000000000000000000000000";

var hexSk = "0xcd9d715f05a4fce8acf3339fd5ee8549c1899c52e4b32da07cffcd91a29ad976";
var hexPk = "0xba781ed1006bd7694282a210485265f1c503f4e6721858b4269ae6d745f7bb4b";
var specHash = "0x418781fb172c2a30c072d58628f5df3f12052a0b785450fb0105f1b98b504561";

const mkFlags = ({useEnc, testing}) => [useEnc === true, testing === true];

const genStdPacked = async () => {
    const [s,e] = await genStartEndTimes();
    const p = mkPacked(s, e, USE_ETH | USE_NO_ENC);
    return p;
}

const genStdBB = async BB => {
    return await BB.new(genRandomBytes32(), await genStdPacked(), zeroAddr);
}

const mkBBPx = (bb, bbaux) => new Proxy(bbaux, {
        get: (obj, method) =>
            async (...args) => {
                if (bb.isFarm)
                    return await bbaux[method](bb.px.address, ...args)
                return await bbaux[method](bb.address, ...args)
            }
    })


async function testEarlyBallot({accounts, BB}) {
    var [startTime, endTime] = await genStartEndTimes();

    const vc = await BB.new(specHash, mkPacked(startTime + 60, endTime, USE_ETH | USE_ENC | USE_TESTING), zeroAddr);
    await assertErrStatus(ERR_BALLOT_CLOSED, vc.submitVote(hexPk, hexPk, { from: accounts[5] }), "should throw on early ballot");
}


async function testInstantiation({accounts, BB, bbaux, log, farm}) {
    var [startTime, endTime] = await genStartEndTimes();
    var shortEndTime = 0;

    assert.deepEqual(await farm.getNBallots(), toBigNumber(0), 'farm has 0 ballots to start with')

    const vc = await BB.new(specHash, mkPacked(startTime, endTime, USE_ETH | USE_ENC | USE_TESTING), zeroAddr, {from: accounts[3]});
    const bCreation = await getBlock('latest')
    const aux = mkBBPx(vc, bbaux);

    // test ballotId is constructed correctly
    assert.equal("1" + specHash.slice(10), vc.ballotId.toString(16), 'ballotId is constructed correctly')

    assert.deepEqual(await farm.getNBallots(), toBigNumber(1), 'farm has 1 ballot now')

    assert.equal(await vc.getOwner(), accounts[3], "Owner must be set on launch.");
    assert.equal(await aux.getSpecHash(), specHash, "specHash should be equal");
    assert.equal((await aux.getStartTime()).toNumber(), startTime, "startTime matches");
    assert.equal((await aux.getEndTime()).toNumber(), endTime, "endTime matches");
    assert.equal(await aux.isTesting(), true, "We should be in test mode");
    assert.equal(await aux.isOfficial(), false, "isOfficial should be false atm");
    assert.equal(await aux.isBinding(), false, "isBinding should be false atm");
    assert.equal(await aux.getEncSeckey(), bytes32zero, "ballot enc key should be zeros before reveal");

    assert.equal((await aux.getNVotesCast()).toNumber(), 0, "Should have no votes at start");

    assert.equal(await vc.farm.getNamespace(), "0x00000001", 'namespace should be bytes4(1) - for this BBFarm at least')
    assert.reallyClose(await vc.farm.getCreationTs(vc.ballotId), toBigNumber(bCreation.timestamp), "creationTs should match expected");

    //// ASSERTIONS FOR INSTANTIATION COMPLETE

    // wait a second so we don't hit the startTime requirement
    await (new Promise((resolve, reject) => { setTimeout(resolve, (startTime * 1000 + 1) - Date.now()) }));

    // console.log('about to testABallot')
    // try a single ballot first
    await testABallot(accounts)(vc, accounts[0], "test ballot single");
    await log("single vote tested")

    assert.equal(await aux.hasVoted(accounts[0]), true, "hasVoted method should work.");
    await log("hasVoted via aux works")

    assert.deepEqual(await vc.farm.getNBallots(), toBigNumber(1), 'farm has 1 ballot')

    const nVotes = accounts.length;
    // console.log(`about to test ${nVotes} votes in parallel via testABallot`)
    try {
        // now a bunch
        await AsyncPar.map(S.range(0, nVotes), async i => {
            return await testABallot(accounts)(vc, accounts[i], "test ballot batch: " + i.toString());
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

    await assertErrStatus(ERR_EARLY_SECKEY, vc.revealSeckey(hexSk, {from: accounts[3]}), "should throw on early reveal");

    // jump to after ballot is closed
    // note: originally used testrpc's evm_increaseTime RPC call, but you can't go backwards or undo, so it screws up other test 👿
    _setTxR = await vc.setEndTime(0, {from: accounts[3]});
    assertNoErr(_setTxR)

    await assert403(vc.revealSeckey(hexSk, { from: accounts[4] }), "cannot reveal seckey from non-admin");

    const _revealSK = await vc.revealSeckey(hexSk, {from: accounts[3]});
    assertOnlyEvent("SeckeyRevealed", _revealSK);
    assertNoErr(_revealSK);
    assert.equal(await aux.getEncSeckey(), hexSk, "secret key should match");

    await assertErrStatus(ERR_BALLOT_CLOSED, vc.submitVote(hexPk, hexPk, { from: accounts[4] }), "late ballot throws");

    // for bbfarm on mainnet
    assert.deepEqual(await farm.getVotingNetworkDetails(), w3.utils.padLeft(farm.address, 64, '0'), 'bbfarm should report voting network details which match its address')
}


async function testSetOwner({accounts, BB}) {
    const acc = accounts;
    const [start] = await genStartEndTimes();
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
    var [startTime, endTime] = await genStartEndTimes();
    var shortEndTime = 0;

    /* ENCRYPTION */

    // best BB with enc
    const _specHash1 = genRandomBytes32();
    const vcEnc = await BB.new(_specHash1, mkPacked(startTime, endTime, USE_ETH | USE_ENC | USE_TESTING), zeroAddr);

    const aux = mkBBPx(vcEnc, bbaux);

    // check we're using enc
    assert.equal(await aux.getSubmissionBits(), USE_ETH | USE_ENC | USE_TESTING, "encryption should be enabled");

    // check submissions with enc
    const bData = hexPk;
    assert.equal(await aux.getNVotesCast(), 0, "no votes yet");

    const tempPk = specHash;
    const _wEnc = await vcEnc.submitVote(bData, tempPk);
    const castTime = (await getBlock('latest')).timestamp
    assertNoErr(_wEnc);
    assert.equal(await aux.getNVotesCast(), 1, "1 vote");
    assertOnlyEvent("SuccessfulVote", _wEnc);
    const ballot = await vcEnc.getVoteAndTime(0);
    assert.equal(ballot[0], bData, "ballot data stored");
    assert.equal(ballot[1], accounts[0], "voter stored correctly");
    assert.equal(ballot[2], tempPk, "pk stored matches");
    assert.reallyClose(ballot[3], toBigNumber(castTime), 'vote cast time matches expected')

    /* NO ENCRYPTION */

    // create ballot box with no enc
    const _specHash2 = genRandomBytes32();
    const vcNoEnc = await BB.new(_specHash2, mkPacked(startTime, endTime, USE_ETH | USE_NO_ENC | USE_TESTING), zeroAddr);
    const auxNoEnc = mkBBPx(vcNoEnc, bbaux);

    // assert useEnc is false with no enc
    assert.equal(await auxNoEnc.getSubmissionBits(), USE_ETH | USE_NO_ENC | USE_TESTING, "encryption should be disabled");
    // test ballot submissions w no enc
    const _bData = genRandomBytes32();
    const _noEnc = await vcNoEnc.submitVote(_bData, "");
    assertNoErr(_noEnc);
    assertOnlyEvent("SuccessfulVote", _noEnc);
    const _bReturned = await vcNoEnc.getVote(0);
    assert.equal(_bReturned[0], _bData, "ballot data matches");
    assert.equal(_bReturned[1], accounts[0], "voter acc matches")
    assert.equal(_bReturned[2], '0x', "pubkey is zero");

    assert.equal(await auxNoEnc.getNVotesCast(), 1, "1 vote");
}


async function testTestMode({accounts, BB, bbaux}) {
    const [s, e] = await genStartEndTimes();
    var vc = await BB.new(specHash, mkPacked(s, e, USE_ETH | USE_NO_ENC), zeroAddr);
    await assertErrStatus(ERR_TESTING_REQ, vc.setEndTime(0), "throws on set end time when not in testing");
}


const testABallot = accounts => async (vc, account, msg = "no message provided") => {
    const myAddr = account;
    const encBallot = genRandomBytes32();
    const vtrPubkey = genRandomBytes32();

    const _submitVote = await asyncAssertDoesNotThrow(() => vc.submitVote(encBallot, vtrPubkey, {
        from: myAddr
    }), msg);
    assertOnlyEvent("SuccessfulVote", _submitVote);
    assertNoErr(_submitVote);
    const {args} = getEventFromTxR("SuccessfulVote", _submitVote);
    const {voteId} = args;

    const [_ballotRet, _addr, _pkRet] = await vc.getVote(voteId);

    assert.equal(_addr, myAddr, "account should match");
    assert.equal(_pkRet, vtrPubkey, "pubkey should match");
    assert.equal(_ballotRet, encBallot, "ballots should match");

    const badNamespaceBId = vc.ballotId.plus(toBigNumber(2).pow(230))
    const badBallotId = vc.ballotId.plus(3)
    await assertRevert(vc.farm.submitVote(badNamespaceBId, encBallot, vtrPubkey), 'cannot submit vote with bad namespace')
    await assertRevert(vc.farm.submitVote(badBallotId, encBallot, vtrPubkey), 'cannot submit vote with bad ballotId')

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


async function testDeprecation({accounts, BB, bbaux}) {
    const [startTime, endTime] = await genStartEndTimes();
    const bb = await BB.new(specHash, mkPacked(startTime, endTime, USE_ETH | USE_NO_ENC | USE_TESTING), zeroAddr);
    const aux = mkBBPx(bb, bbaux);

    assert.equal(await aux.isDeprecated(), false, "should not be deprecated");
    await bb.setDeprecated();
    assert.equal(await aux.isDeprecated(), true, "should be deprecated");

    await assertRevert(bb.submitVote(genRandomBytes32(), ""), "submit ballot should throw after deprecation");
}


const testVersion = async ({BB, bbaux}) => {
    const [startTime, endTime] = await genStartEndTimes();
    const bb = await BB.new(specHash, mkPacked(startTime, endTime, USE_ETH | USE_ENC), zeroAddr);
    assert.deepEqual(await bb.farm.getBBLibVersion(), toBigNumber(7), "version (BBLib) should be 7");
    assert.deepEqual(await bb.farm.getVersion(), toBigNumber(3), "version (bbfarm) should be 3");
}


const testSponsorship = async ({accounts, BB, bbaux}) => {
    const [owner, u1, u2, u3, u4, u5, u6, u7, u8, emergencyAdmin] = accounts;

    const [startTime, endTime] = await genStartEndTimes();
    const payments = await SvPayments.new(emergencyAdmin);
    assert.equal(await payments.getPayTo(), owner, 'payto as expected')
    // don't need to include the farm address here bc we inject ix.address into BB
    const ix = await SvIndex.new(zeroAddr, payments.address, zeroAddr, zeroAddr, zeroAddr);
    const bb = await BB.new(specHash, mkPacked(startTime, endTime, USE_ETH | USE_ENC | USE_TESTING), ix.address);

    assert.deepEqual(toBigNumber(0), await bb.getTotalSponsorship(), "sponsorship should be 0 atm");

    const balPre = await getBalance(owner);
    await bb.sendTransaction({
        from: u1,
        value: toBigNumber(oneEth)
    });
    const balPost = await getBalance(owner);
    assert.deepEqual(balPost, toBigNumber(oneEth).plus(balPre), "sponsorship balance (payTo) should match expected");

    assert.deepEqual(await bb.getTotalSponsorship(), toBigNumber(oneEth), "getTotalSponsorship should match expected");

    // make sponsorship fail via the tx failing

    const testHelper = await TestHelper.new()
    await payments.setPayTo(testHelper.address);

    await assertRevert(bb.sendTransaction({
        from: u1,
        value: 1999  // special value that will cause testHelper to throw
    }), 'should throw if payTo tx fails');
}


const testBadSubmissionBits = async ({accounts, BB, bbaux}) => {
    const [s, e] = await genStartEndTimes();

    const flags = [USE_ENC, USE_NO_ENC];
    // const flagCombos = R.map(f => R.reduce((acc, i) => {
    //     return acc | i;
    // }, 0, R.without([f], flags)), flags);
    const badPacked1 = [mkPacked(s, e, USE_ETH | USE_ENC | USE_NO_ENC)];
    const badPacked2 = [mkPacked(s, e, USE_ETH)];

    await Promise.all(R.map(p => {
        return assertRevert(BB.new(specHash, p, zeroAddr), "bad submission bits (conflicting) should fail");
    }, badPacked1));

    await Promise.all(R.map(p => {
        return assertRevert(BB.new(specHash, p, zeroAddr), "bad submission bits (not enough) should fail");
    }, badPacked2));

    await assertRevert(BB.new(specHash, mkPacked(s, e, 32 | USE_ETH | USE_ENC), zeroAddr), "sub bits in middle banned");
    // make sure the ballot works excluding the `32` in subBits above
    await BB.new(specHash, mkPacked(s, e, USE_ETH | USE_ENC), zeroAddr);
    await assertRevert(BB.new(specHash, mkPacked(s, e, USE_SIGNED | USE_ENC), zeroAddr), "no signed ballots");

    const bannedBits = R.map(i => 2 ** i, [1,4,5,6,7,8,9,10,11,12])
    const bannedPacked = R.map(i => mkPacked(s, e, i | USE_ETH | USE_NO_ENC), bannedBits)

    await Promise.all(R.map(p => {
        return assertRevert(BB.new(specHash, p, zeroAddr), "banned submission bits should not be allowed")
    }, bannedPacked))
}


const testCommStatus = async ({accounts, BB, bbaux, bbName}) => {
    const [s,e] = await genStartEndTimes();

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
        const bb = await BB.new(specHash, p, zeroAddr);
        const aux = mkBBPx(bb, bbaux)
        assert.equal(await aux.qualifiesAsCommunityBallot(), true, `${bbName} Ballot with packed ${p} should qualify as comm`)
    }, goodPacked))

    await Promise.all(R.map(async p => {
        const specHash = genRandomBytes32();
        const bb = await BB.new(specHash, p, zeroAddr);
        const aux = mkBBPx(bb, bbaux)
        assert.equal(await aux.qualifiesAsCommunityBallot(), false, `${bbName} Ballot with packed ${p} should not qualify as community ballot`)
    }, badPacked));
}


const testOwner = async ({accounts, BB, bbaux}) => {
    const bb = await genStdBB(BB);
    assert.equal(await bb.owner(), accounts[0], "owner should be as expected");

    await bb.setOwner(accounts[1], {from: accounts[0]});
    assert.equal(await bb.owner(), accounts[1], "owner should be as expected after update");

    await assertRevert(bb.setOwner(accounts[2], {from: accounts[0]}), "setOwner permissions okay");
}


const testGetVotes = async ({accounts, BB, bbaux, doLog}) => {
    const [s, e] = await genStartEndTimes();

    const zeroSig = [bytes32zero, bytes32zero]
    const testSig1 = [genRandomBytes32(), genRandomBytes32()];
    const testSig2 = [genRandomBytes32(), genRandomBytes32()];

    const _ballot1 = genRandomBytes32();
    const _ballot2 = genRandomBytes32();

    const _pk1 = genRandomBytes32();
    const _pk2 = genRandomBytes32();

    const bbNoEnc = await BB.new(genRandomBytes32(), mkPacked(s, e, (USE_ETH | USE_NO_ENC)), zeroAddr);
    const bbEnc = await BB.new(genRandomBytes32(), mkPacked(s, e, (USE_ETH | USE_ENC)), zeroAddr);

    const testBBFarmAux = async ({bb, useEnc}) => {
        let aux, getVotesFrom, getVotes;
        aux = await BBFarmAux.new();
        getVotesFrom = acct => aux.getVotesFrom(bb.farm.address, bb.ballotId, acct)
        getVotes = () => aux.getVotes(bb.farm.address, bb.ballotId)

        // test getBallotsEthFrom
        assert.deepEqual(await getVotesFrom(accounts[0]), [[], [], []], "getBallotsFrom should be empty before any votes");
        assert.deepEqual(await getVotes(), [[], [], []], "getBallots should be empty before any votes");

        await doLog(`submitting votes now ${toJson({useEnc})}`)
        await bb.submitVote(_ballot1, useEnc ? _pk1 : "", {from: accounts[0]});
        await bb.submitVote(_ballot2, useEnc ? _pk2 : "", {from: accounts[1]});

        // we use ABIEncoderV2 here in the BBFarmAux
        // I suspect there's a problem with web3 v0.20.x decoding these responses correctly
        // so just yolo i guess...
        // const mkExtraGVF = (i, _b) => `0x00000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000${i}0000000000000000000000000000000000000000000000000000000000000001${_b.slice(2)}`
        // note: just going to ignore the `extras` response - it's the last one on all results

        assert.deepEqual((await getVotesFrom(accounts[0])).slice(0,2),
            [ [toBigNumber(0)]
            , [_ballot1]
            // , useEnc ? [_pk1] : [mkExtraGVF(0, _ballot1)
            ], `getBallotsFrom (a0, useEnc: ${useEnc}, pk: ${_pk1}, b: ${_ballot1} should match expected`);

        assert.deepEqual((await getVotesFrom(accounts[1])).slice(0,2),
            [ [toBigNumber(1)]
            , [_ballot2]
            // , useEnc ? [_pk2] : [mkExtraGVF(1, _ballot2)
            ], `getBallotsFrom (a1, useEnc: ${useEnc}) should match expected`);

        assert.deepEqual((await getVotes()).slice(0,2),
            [ [_ballot1, _ballot2]
            , [accounts[0], accounts[1]]
            //, useEnc ? [_pk1, _pk2] : [mkExtraGVF(0, _ballot1), mkExtraGVF(1, _ballot2)]
            ], `getBallots (useEnc: ${useEnc}) should match`)

        assert.deepEqual(await bb.getVote(0), [_ballot1, accounts[0], useEnc ? _pk1 : "0x"], 'vote 0 should match')
        assert.deepEqual(await bb.getVote(1), [_ballot2, accounts[1], useEnc ? _pk2 : "0x"], 'vote 1 should match')
    }

    await testBBFarmAux({bb: bbNoEnc, useEnc: false});
    await testBBFarmAux({bb: bbEnc, useEnc: true});
}


const testBBFarmAux2 = async ({accounts, BB, bbaux, doLog, owner}) => {
    const [_, u1, u2, u3, u4] = accounts

    let [s, e] = await genStartEndTimes();
    const _ballot1 = genRandomBytes32();
    const _ballot2 = genRandomBytes32();

    const sb = (USE_ETH | USE_NO_ENC)
    const packed = mkPacked(s, e, sb)
    const specHash = genRandomBytes32();
    const bb = await BB.new(specHash, packed, owner);
    const aux = await BBFarmAux2.new()

    const expInitGetBallotDetails = [false, toBigNumber(0), zeroHash, toBigNumber(sb), toBigNumber(s), toBigNumber(e), specHash, false, owner, zeroHash.slice(0, 34)]
    const initGetBallotDetails = await aux.getBallotDetails(bb.farm.address, bb.ballotId, u1)
    assert.deepEqual(initGetBallotDetails, expInitGetBallotDetails, 'init getBallotDetails matches')

    await doLog(`submitting votes now`)
    await bb.submitVote(_ballot1, "", {from: u1});
    await doLog(`voted once`)
    await bb.submitVote(_ballot2, "", {from: u2});
    await doLog(`voted twice`)

    await doLog(`getting ballot details`)
    const expGetBallotDetails = [true, toBigNumber(2), zeroHash, toBigNumber(sb), toBigNumber(s), toBigNumber(e), specHash, false, owner, zeroHash.slice(0, 34)]
    const getBallotDetails = await aux.getBallotDetails(bb.farm.address, bb.ballotId, u1)
    assert.deepEqual(expGetBallotDetails, getBallotDetails, 'getBallotDetails after 2 votes matches')

    // note: getBBFarmAddressAndBallotId and ballotIdToDetails tested in indexTests
    await doLog("done")
}


const testEndTimeFuture = async ({BB, accounts}) => {
    const [s, e] = await genStartEndTimes();
    const packed = mkPacked(s, s - 10, USE_ETH | USE_NO_ENC);
    await assertRevert(BB.new(genRandomBytes32(), packed, accounts[0]), 'should throw on end time in past')
}


const mkProxyVote = async ({ballotId, sequence = 4919, extra = '0x', privKey = null}) => {
    privKey = privKey || genRandomBytes32()
    const {address} = Account.fromPrivate(privKey)

    const _ballotId = w3.utils.toBN(ballotId)
    const vote = genRandomBytes(32)

    const {proxyReq} = mkSignedBallotForProxy(_ballotId, sequence, vote, extra, privKey, {skipSequenceSizeCheck: true})

    return {proxyReq, extra, vote, sequence, address, privKey}
}


const testProxyVote = async ({BB, accounts, doLog, farm}) => {
    const [u0, u1, u2, u3] = accounts;
    const bb = await BB.new(genRandomBytes32(), await genStdPacked(), zeroAddr, u0)

    const {proxyReq, extra, vote, sequence, address} = await mkProxyVote({ballotId: bb.ballotId})

    await doLog(`Generated proxyReq: ${toJson(proxyReq)}`)

    const b1 = await getBalance(u1)
    await farm.submitProxyVote(proxyReq, extra, {from: u1, gasPrice: 1})
    const b2 = await getBalance(u1)
    console.log(`Cost of casting a vote by proxy: ${b1.minus(b2).toFixed()} gas`)

    assert.deepEqual(await bb.getVote(0), [vote, address.toLowerCase(), extra], 'ballot submitted via proxy should match expected')

    const b3 = await getBalance(u3)
    await bb.submitVote(vote, extra, {from: u3, gasPrice: 1})
    const b4 = await getBalance(u3)
    console.log(`Cost of casting a vote directly: ${b3.minus(b4).toFixed()} gas`)

    const b5 = await getBalance(u2)
    await bb.submitVote(vote, w3.utils.padRight("0x", 128, 'f'), {from: u2, gasPrice: 1})
    const b6 = await getBalance(u2)
    console.log(`Cost of casting a vote directly w 64 bytes of extra: ${b5.minus(b6).toFixed()} gas`)
}


const testProxyVoteReplayProtection = async ({BB, farm, accounts, doLog}) => {
    // also test sequence number props

    const [, u1, u2, u3] = accounts;
    const bb = await genStdBB(BB);
    const ballotId = bb.ballotId

    const privKey = genRandomBytes32()

    const pxVote1 = await mkProxyVote({ballotId, sequence: 1, privKey})
    const pxVote2 = await mkProxyVote({ballotId, sequence: 2, privKey})
    const pxVote3 = await mkProxyVote({ballotId, sequence: 3, privKey})
    const pxVoteMax = await mkProxyVote({ballotId, sequence: 0xffffffff, privKey})
    const pxVoteOverMax = await mkProxyVote({ballotId, sequence: 0xffffffff + 1, privKey})
    const pxAddr = pxVote1.address;

    assert.deepEqual(await farm.getSequenceNumber(ballotId, pxAddr), toBigNumber(0), 'seq = 0')
    await farm.submitProxyVote(pxVote1.proxyReq, pxVote1.extra)
    assert.deepEqual(await farm.getSequenceNumber(ballotId, pxAddr), toBigNumber(1), 'seq = 1')
    await assertRevert(farm.submitProxyVote(pxVote1.proxyReq, pxVote1.extra), 'cannot submit vote twice')
    // submit vote 3
    await farm.submitProxyVote(pxVote3.proxyReq, pxVote3.extra)
    assert.deepEqual(await farm.getSequenceNumber(ballotId, pxAddr), toBigNumber(3), 'seq = 3')
    await assertRevert(farm.submitProxyVote(pxVote2.proxyReq, pxVote2.extra), 'cannot submit vote with earlier sequence number')

    await farm.submitProxyVote(pxVoteMax.proxyReq, pxVoteMax.extra)
    assert.deepEqual(await farm.getSequenceNumber(ballotId, pxAddr), toBigNumber(0xffffffff), 'seq = 0xffffffff')

    await assertRevert(farm.submitProxyVote(pxVoteOverMax.proxyReq, pxVoteOverMax.extra), 'seq max is 0xffffffff - this should overflow to 0 and thus fail')

    assert.deepEqual(await farm.getSequenceNumber(ballotId, u1), toBigNumber(0), 'seq = 0 for u1 init')
    await bb.submitVote(genRandomBytes32(), '0x', {from: u1})
    // can vote directly twice+
    await bb.submitVote(genRandomBytes32(), '0x', {from: u1})
    assert.deepEqual(await farm.getSequenceNumber(ballotId, u1), toBigNumber(0xffffffff), 'seq = 0xffffffff')
}


const testRevertConditions = async ({BB, farm, accounts, doLog}) => {
    const specHash1 = genRandomBytes32();
    const bb1 = await BB.new(specHash1, await genStdPacked(), zeroAddr);
    await assertRevert(BB.new(specHash1, await genStdPacked(), zeroAddr), 'cannot create ballot with same specHash')
    await assertRevert(BB.new(zeroHash, await genStdPacked(), zeroAddr), 'cannot create ballot with zero specHash')
    await assertRevert(farm.initBallotProxy(27, zeroHash, zeroAddr, Array(4).fill(zeroHash)), 'initBallotProxy reverts on std bbfarm')
}


function sAssertEq(a, b, msg) {
    return assert.true(S.equals(a, b), msg);
}


const _wrapTest = ({accounts, bbName, mkFarm}, f) => {
    return async () => {
        const Emitter = await EmitterTesting.new();
        const log = m => Emitter.log(m);
        const doLog = log;

        await log("Starting test wrap")

        const bbaux = await BallotAux.new();
        const farm = await BBFarm.new();

        await farm.setPermissions(accounts[0], true)

        await log("Finished wrap contract deployment")

        const mkNewBB = async function(specHash, packed, index, lastArg) {
            await log(`Deploying new BB with args: ${[specHash, packed, index, lastArg]}`)

            const from = (lastArg && lastArg.from) ? lastArg.from : accounts[0];
            const txOpts = isTxOpts(lastArg) ? {...lastArg, from: accounts[0]} : {}
            const _initBBEvent = await farm.initBallot(specHash, packed, index, from, zeroHash.slice(0, 2+24*2), txOpts)
            const {args: {ballotId}} = getEventFromTxR("BallotCreatedWithID", _initBBEvent)

            await doLog(`wrapper: Created ballot with ID: ${ballotId.toFixed()}`);

            const bbFarmPx = await BBFarmPx.new(farm.address, ballotId)
            await doLog(`wrapper: Created bbFarmPx`)

            const px = new Proxy({}, {
                get: (obj, method) => {
                    if (method == "then")
                        return undefined

                    if (method == "isFarm")
                        return true

                    if (method == "px")
                        return bbFarmPx

                    if (method == "farm")
                        return farm;

                    if (method == "ballotId")
                        return ballotId;

                    return async (...pxargs) => {
                        // this method isn't just prefixed with ballotId, so best to return directly
                        if (method == "submitProxyVote")
                            return await farm[method](...pxargs);

                        pxargs = R.concat([ballotId], pxargs)

                        if (method == "owner" || method == "getOwner")
                            return (await farm.getDetails(ballotId, zeroAddr))[8]

                        if (method == "setOwner")
                            method = "setBallotOwner"

                        if (method == "getVersion")
                            return await farm.getBBLibVersion()

                        if (method == "sendTransaction")
                            method = "sponsor"

                        // note we add the ballotId above so all good to not add it in here
                        return await farm[method](...pxargs)
                    }
            }})

            return px;
        }

        BB = {
            new: mkNewBB,
            farm
        }

        await log("Finished test wrapping - starting test now")

        return await f({owner: accounts[0], accounts, BB, log, doLog, bbaux, bbName, farm});
    };
}


contract("BallotBox", function(accounts) {
    const tests = [
        ["should instantiate correctly", testInstantiation],
        ["test bbFarmAux2", testBBFarmAux2],
        ["test sponsorship", testSponsorship],
        ["test revert conditions", testRevertConditions],
        ["test proxy vote", testProxyVote],
        ["test proxy vote replay attacks", testProxyVoteReplayProtection],
        ["test getBallots*From", testGetVotes],
        ["should allow setting owner", testSetOwner],
        ["should enforce encryption based on PK submitted", testEncryptionBranching],
        ["should not allow testing functions if testing mode is false", testTestMode],
        ["should throw on early ballot", testEarlyBallot],
        ["should allow deprecation", testDeprecation],
        ["should have correct version", testVersion],
        ["test bad submission bits", testBadSubmissionBits],
        ["test community status", testCommStatus],
        ["test owner", testOwner],
        ["test end time must be in future", testEndTimeFuture],
    ]
    R.map(([desc, f]) => {
        it("BBFarm: " + desc, _wrapTest({accounts, bbName: "Farm", mkFarm: true}, f))
    }, tests);
});
