var EmitterTesting = artifacts.require("./EmitterTesting");
var SvIndex = artifacts.require("./SVIndex");
var SvPayments = artifacts.require("./SVPayments");
var RemoteBBFarmPx = artifacts.require("./RemoteBBFarmProxy")
var RemoteBBFarm = artifacts.require("./RemoteBBFarm")

require("./testUtils")();

const naclJs = require("js-nacl")
const crypto = require("crypto")
const { mkSignedBallotForProxy } = require("sv-lib/lib/ballotBox")
const Account = require("eth-lib/lib/account")
const rlp = require('rlp')

const R = require('ramda')

const AsyncPar = require("async-parallel");

const { create, env } = require("sanctuary");
const S = create({ checkTypes: true, env });

const bytes32zero = "0x0000000000000000000000000000000000000000000000000000000000000000";

var hexSk = "0xcd9d715f05a4fce8acf3339fd5ee8549c1899c52e4b32da07cffcd91a29ad976";
var hexPk = "0xba781ed1006bd7694282a210485265f1c503f4e6721858b4269ae6d745f7bb4b";
var specHash = "0x418781fb172c2a30c072d58628f5df3f12052a0b785450fb0105f1b98b504561";


const genBallot = async (farmPx, owner = zeroAddr, packed = null) => {
    const specHash = genRandomBytes32()
    const txr = await farmPx.initBallot(specHash, packed || await genStdPacked(), zeroAddr, owner, zeroAddr);
    const {args: {ballotId}} = getEventFromTxR('BallotCreatedWithID', txr)
    return ballotId
}


const genStdPacked = async () => {
    const [s,e] = await genStartEndTimes();
    const p = mkPacked(s, e, USE_ETH | USE_NO_ENC);
    return p;
}

const toRlp = (ethHex) => {
    let toEnc = Buffer.from(ethHex.slice(2), 'hex')
    if (Array.isArray(ethHex)) {
        toEnc = R.map(h => Buffer.from(h.slice(2), 'hex'), ethHex)
    }
    return '0x' + rlp.encode(toEnc).toString('hex')
}

const fromRlp = ethHex => {
    const decoded = rlp.decode(Buffer.from(ethHex.slice(2), 'hex'))

    if (Array.isArray(decoded)) {
        return R.map(i => '0x' + i.toString('hex'), decoded)
    }
    return '0x' + decoded.toString('hex')
}


async function testInstantiation({owner, accounts, farmPx, farmRemote, doLog}) {
    await doLog("## Testing initial conditions")

    assert.equal(await farmPx.owner(), owner, "Owner - farm px");
    assert.equal(await farmRemote.owner(), owner, "Owner - farm remote");

    assert.deepEqual(await farmPx.getVersion(), toBigNumber(3), "ver - farm px");
    assert.deepEqual(await farmRemote.getVersion(), toBigNumber(3), "ver - farm remote");

    assert.deepEqual(await farmPx.getBBLibVersion(), toBigNumber(7), "bblib v - farm px");
    assert.deepEqual(await farmRemote.getBBLibVersion(), toBigNumber(7), "bblib v - farm remote");

    assert.equal(await farmPx.getNamespace(), "0x013d0001", 'namespace px')
    assert.equal(await farmRemote.getNamespace(), "0x013d0001", 'namespace remote')

    assert.deepEqual(await farmPx.getNBallots(), toBigNumber(0), "nballots - farm px");
    assert.deepEqual(await farmRemote.getNBallots(), toBigNumber(0), "nballots - farm remote");

    assert.equal(await farmRemote.getVotingNetworkDetails(), w3.utils.padLeft(farmRemote.address, 64, '0'), 'voting network details on remote network')
    const expVNDs = "0x00000000000000010000003d" + farmRemote.address.slice(2)
    assert.equal(await farmPx.getVotingNetworkDetails(), expVNDs, 'voting network details on host network (px)')
}


async function testSetOwner({owner, accounts, farmPx, farmRemote, doLog}) {
    const [start] = await genStartEndTimes();
    const [,u1,u2] = accounts
    const ballotId = await genBallot(farmPx, owner, mkPacked(start, start + 60, USE_ETH | USE_NO_ENC));
    const owner1 = (await farmPx.getDetails(ballotId, zeroAddr))[8];
    assert.equal(owner, owner1, "owner should be acc[0]");

    // fraud set owner
    await assert403(farmPx.setBallotOwner(ballotId, u2, {from: u1}), "should throw if setOwner called by non-owner");

    // good set owner
    const soTxr = await farmPx.setBallotOwner(ballotId, u1);
    assertNoErr(soTxr);
    const owner2 = (await farmPx.getDetails(ballotId, zeroAddr))[8];
    assert.equal(u1, owner2, "owner should change when legit req");
}


async function testEncryptionBranching({owner, accounts, farmPx, farmRemote, doLog}) {
    var [startTime, endTime] = await genStartEndTimes();
    var shortEndTime = 0;

    /* ENCRYPTION */

    // best BB with enc
    const bIdEnc = await genBallot(farmPx, owner, mkPacked(startTime, endTime, USE_ETH | USE_ENC | USE_TESTING));

    // check cretionTs
    const {timestamp: bEncCreationTs} = await getBlock('latest')
    assert.deepEqual(await farmPx.getCreationTs(bIdEnc), toBigN(bEncCreationTs), 'creation ts matches')

    // check we're using enc
    const _sb = (await farmPx.getDetails(bIdEnc, zeroAddr))[3]
    assert.equal(_sb, USE_ETH | USE_ENC | USE_TESTING, "encryption should be enabled");

    // check submissions with enc
    const bData = hexPk;
    assert.equal((await farmRemote.getDetails(bIdEnc, zeroAddr))[1], 0, "no votes yet");

    const tempPk = specHash;
    const _wEnc = await farmRemote.submitVote(bIdEnc, bData, tempPk);
    const castTime = (await getBlock('latest')).timestamp
    assertNoErr(_wEnc);
    assert.equal((await farmRemote.getDetails(bIdEnc, zeroAddr))[1], 1, "1 vote");
    assertOnlyEvent("SuccessfulVote", _wEnc);
    const ballot = await farmRemote.getVoteAndTime(bIdEnc, 0);
    assert.equal(ballot[0], bData, "ballot data stored");
    assert.equal(ballot[1], owner, "voter stored correctly");
    assert.equal(ballot[2], tempPk, "pk stored matches");
    assert.reallyClose(ballot[3], toBigNumber(castTime), 'vote cast time matches expected')

    /* NO ENCRYPTION */

    // create ballot box with no enc
    const bIdNoEnc = await genBallot(farmPx, owner, mkPacked(startTime, endTime, USE_ETH | USE_NO_ENC | USE_TESTING));

    // assert useEnc is false with no enc
    assert.equal((await farmPx.getDetails(bIdNoEnc, zeroAddr))[3], USE_ETH | USE_NO_ENC | USE_TESTING, "encryption should be disabled");
    // test ballot submissions w no enc
    const _bData = genRandomBytes32();
    const _noEnc = await farmRemote.submitVote(bIdNoEnc, _bData, "");
    assertNoErr(_noEnc);
    assertOnlyEvent("SuccessfulVote", _noEnc);
    const _bReturned = await farmRemote.getVoteAndTime(bIdNoEnc, 0);
    assert.equal(_bReturned[0], _bData, "ballot data matches");
    assert.equal(_bReturned[1], accounts[0], "voter acc matches")
    assert.equal(_bReturned[2], '0x', "pubkey is zero");

    assert.equal((await farmRemote.getDetails(bIdEnc, zeroAddr))[1], 1, "1 vote");
}


async function testTestMode({owner, accounts, farmPx, farmRemote, doLog}) {
    const [s, e] = await genStartEndTimes();
    var ballotId = await genBallot(farmPx, owner, mkPacked(s, e, USE_ETH | USE_NO_ENC))
    await assertErrStatus(ERR_TESTING_REQ, farmPx.setEndTime(ballotId, 0), "throws on set end time when not in testing");
    var ballotId2 = await genBallot(farmPx, owner, mkPacked(s, e, USE_ETH | USE_NO_ENC | USE_TESTING))
    // this works though
    await farmPx.setEndTime(ballotId2, 0)
}


// const testABallot = accounts => async (vc, account, msg = "no message provided") => {
//     const myAddr = account;
//     const encBallot = genRandomBytes32();
//     const vtrPubkey = genRandomBytes32();

//     const _submitVote = await asyncAssertDoesNotThrow(() => vc.submitVote(encBallot, vtrPubkey, {
//         from: myAddr
//     }), msg);
//     assertOnlyEvent("SuccessfulVote", _submitVote);
//     assertNoErr(_submitVote);
//     const {args} = getEventFromTxR("SuccessfulVote", _submitVote);
//     const {voteId} = args;

//     const [_ballotRet, _addr, _pkRet] = await vc.getVote(voteId);

//     assert.equal(_addr, myAddr, "account should match");
//     assert.equal(_pkRet, vtrPubkey, "pubkey should match");
//     assert.equal(_ballotRet, encBallot, "ballots should match");

//     const badNamespaceBId = vc.ballotId.plus(toBigNumber(2).pow(230))
//     const badBallotId = vc.ballotId.plus(3)
//     await assertRevert(vc.farm.submitVote(badNamespaceBId, encBallot, vtrPubkey), 'cannot submit vote with bad namespace')
//     await assertRevert(vc.farm.submitVote(badBallotId, encBallot, vtrPubkey), 'cannot submit vote with bad ballotId')

//     return true;
// };


// const _genSigned = () => {
//     return {
//         ballot: genRandomBytes32(),
//         edPk: genRandomBytes32(),
//         sig: [genRandomBytes32(), genRandomBytes32()],
//         curvePk: genRandomBytes32()
//     }
// }


async function testDeprecation({owner, accounts, farmPx, farmRemote, doLog}) {
    const [startTime, endTime] = await genStartEndTimes();
    const ballotId = await genBallot(farmPx, owner, mkPacked(startTime, endTime, USE_ETH | USE_NO_ENC | USE_TESTING));

    assert.equal((await farmPx.getDetails(ballotId, zeroAddr))[7], false, "should not be deprecated");
    await farmPx.setDeprecated(ballotId);
    assert.equal((await farmPx.getDetails(ballotId, zeroAddr))[7], true, "should be deprecated");
}


const testVersion = async ({owner, accounts, farmPx, farmRemote, doLog}) => {
    assert.deepEqual(await farmPx.getBBLibVersion(), toBigNumber(7), "version (BBLib) should be 7");
    assert.deepEqual(await farmPx.getVersion(), toBigNumber(3), "version (bbfarm) should be 3");
}



const testBadSubmissionBits = async ({owner, accounts, farmPx, farmRemote, doLog}) => {
    const [s, e] = await genStartEndTimes();

    const flags = [USE_ENC, USE_NO_ENC];
    // const flagCombos = R.map(f => R.reduce((acc, i) => {
    //     return acc | i;
    // }, 0, R.without([f], flags)), flags);
    const badPacked1 = [mkPacked(s, e, USE_ETH | USE_ENC | USE_NO_ENC)];
    const badPacked2 = [mkPacked(s, e, USE_ETH)];

    await Promise.all(R.map(p => {
        return assertRevert(farmPx.initBallot(specHash, p, zeroAddr, zeroAddr, "0x00"), "bad submission bits (conflicting) should fail");
    }, badPacked1));

    await Promise.all(R.map(p => {
        return assertRevert(farmPx.initBallot(specHash, p, zeroAddr, zeroAddr, "0x00"), "bad submission bits (not enough) should fail");
    }, badPacked2));

    await assertRevert(farmPx.initBallot(specHash, mkPacked(s, e, 32 | USE_ETH | USE_ENC), zeroAddr, zeroAddr, "0x00"), "sub bits in middle banned");
    // make sure the ballot works excluding the `32` in subBits above
    await farmPx.initBallot(specHash, mkPacked(s, e, USE_ETH | USE_ENC), zeroAddr, zeroAddr, "0x00");
    await assertRevert(farmPx.initBallot(specHash, mkPacked(s, e, USE_SIGNED | USE_ENC), zeroAddr, zeroAddr, "0x00"), "no signed ballots");

    const bannedBits = R.map(i => 2 ** i, [1,4,5,6,7,8,9,10,11,12])
    const bannedPacked = R.map(i => mkPacked(s, e, i | USE_ETH | USE_NO_ENC), bannedBits)

    await Promise.all(R.map(p => {
        return assertRevert(farmPx.initBallot(specHash, p, zeroAddr, zeroAddr, "0x00"), "banned submission bits should not be allowed")
    }, bannedPacked))
}


// const testCommStatus = async ({accounts, BB, bbaux, bbName}) => {
//     const [s,e] = await genStartEndTimes();

//     const std = USE_ETH | USE_NO_ENC;
//     const goodBits = [
//         std,
//     ]

//     const badBits = [
//         std | IS_OFFICIAL,
//         std | IS_BINDING,
//         std | IS_OFFICIAL | IS_BINDING,
//         USE_ETH | USE_ENC,
//     ]

//     // console.log(bbName, goodBits, badBits)

//     const goodPacked = R.map(b => mkPacked(s,e,b), goodBits)
//     const badPacked = R.map(b => mkPacked(s,e,b), badBits)

//     await Promise.all(R.map(async p => {
//         const specHash = genRandomBytes32();
//         const bb = await BB.new(specHash, p, zeroAddr);
//         const aux = mkBBPx(bb, bbaux)
//         assert.equal(await aux.qualifiesAsCommunityBallot(), true, `${bbName} Ballot with packed ${p} should qualify as comm`)
//     }, goodPacked))

//     await Promise.all(R.map(async p => {
//         const specHash = genRandomBytes32();
//         const bb = await BB.new(specHash, p, zeroAddr);
//         const aux = mkBBPx(bb, bbaux)
//         assert.equal(await aux.qualifiesAsCommunityBallot(), false, `${bbName} Ballot with packed ${p} should not qualify as community ballot`)
//     }, badPacked));
// }


const testOwner = async ({owner, accounts, farmPx, farmRemote, doLog}) => {
    const ballotId = await genBallot(farmPx, owner)
    assert.equal((await farmPx.getDetails(ballotId, zeroAddr))[8], owner, "owner should be as expected");

    await farmPx.setBallotOwner(ballotId, accounts[1], {from: owner});
    assert.equal((await farmPx.getDetails(ballotId, zeroAddr))[8], accounts[1], "owner should be as expected after update");

    await assertRevert(farmPx.setBallotOwner(ballotId, accounts[1], {from: owner}), "setOwner permissions okay");
}


const testEndTimePast = async ({owner, accounts, farmPx, farmRemote, doLog}) => {
    const [s, e] = await genStartEndTimes();
    const packed = mkPacked(s, s - 10, USE_ETH | USE_NO_ENC);
    await assertRevert(farmPx.initBallot(genRandomBytes32(), packed, accounts[0], accounts[0], "0x00"), 'should throw on end time in past')
}


const mkProxyVote = async ({ballotId, sequence = 4919, extra = '0x', privKey = null}) => {
    privKey = privKey || genRandomBytes32()
    const {address} = Account.fromPrivate(privKey)

    const _ballotId = w3.utils.toBN(ballotId)
    const vote = genRandomBytes(32)

    const {proxyReq} = mkSignedBallotForProxy(_ballotId, sequence, vote, extra, privKey, {skipSequenceSizeCheck: true})

    return {proxyReq, extra, vote, sequence, address, privKey}
}


const testProxyVote = async ({owner, accounts, farmPx, farmRemote, doLog}) => {
    const [, u1, u2, u3] = accounts;
    const ballotId = await genBallot(farmPx);

    const {proxyReq, extra, vote, sequence, address} = await mkProxyVote({ballotId})

    await doLog(`Generated proxyReq: ${toJson(proxyReq)}`)

    const b1 = await getBalance(u1)
    await farmRemote.submitProxyVote(proxyReq, extra, {from: u1, gasPrice: 1})
    const {timestamp: v1Ts} = await getBlock('latest')
    const b2 = await getBalance(u1)
    console.log(`Cost of casting a vote by proxy: ${b1.minus(b2).toFixed()} gas`)

    assert.deepEqual(await farmRemote.getVoteAndTime(ballotId, 0), [vote, address.toLowerCase(), extra, toBigN(v1Ts)], 'ballot submitted via proxy should match expected')

    const b3 = await getBalance(u3)
    await farmRemote.submitVote(ballotId, vote, extra, {from: u3, gasPrice: 1})
    const b4 = await getBalance(u3)
    console.log(`Cost of casting a vote directly: ${b3.minus(b4).toFixed()} gas`)

    const b5 = await getBalance(u2)
    await farmRemote.submitVote(ballotId, vote, w3.utils.padRight("0x", 128, 'f'), {from: u2, gasPrice: 1})
    const b6 = await getBalance(u2)
    console.log(`Cost of casting a vote directly w 64 bytes of extra: ${b5.minus(b6).toFixed()} gas`)
}


const testProxyVoteReplayProtection = async ({owner, accounts, farmPx, farmRemote, doLog}) => {
    // also test sequence number props
    const [, u1, u2, u3] = accounts;
    const ballotId = await genBallot(farmPx);

    const privKey = genRandomBytes32()

    const pxVote1 = await mkProxyVote({ballotId, sequence: 1, privKey})
    const pxVote2 = await mkProxyVote({ballotId, sequence: 2, privKey})
    const pxVote3 = await mkProxyVote({ballotId, sequence: 3, privKey})
    const pxVoteMax = await mkProxyVote({ballotId, sequence: 0xffffffff, privKey})
    const pxVoteOverMax = await mkProxyVote({ballotId, sequence: 0xffffffff + 1, privKey})
    const pxAddr = pxVote1.address;

    assert.deepEqual(await farmRemote.getSequenceNumber(ballotId, pxAddr), toBigNumber(0), 'seq = 0')
    await farmRemote.submitProxyVote(pxVote1.proxyReq, pxVote1.extra)
    assert.deepEqual(await farmRemote.getSequenceNumber(ballotId, pxAddr), toBigNumber(1), 'seq = 1')
    await assertRevert(farmRemote.submitProxyVote(pxVote1.proxyReq, pxVote1.extra), 'cannot submit vote twice')
    // submit vote 3
    await farmRemote.submitProxyVote(pxVote3.proxyReq, pxVote3.extra)
    assert.deepEqual(await farmRemote.getSequenceNumber(ballotId, pxAddr), toBigNumber(3), 'seq = 3')
    await assertRevert(farmRemote.submitProxyVote(pxVote2.proxyReq, pxVote2.extra), 'cannot submit vote with earlier sequence number')

    await farmRemote.submitProxyVote(pxVoteMax.proxyReq, pxVoteMax.extra)
    assert.deepEqual(await farmRemote.getSequenceNumber(ballotId, pxAddr), toBigNumber(0xffffffff), 'seq = 0xffffffff')

    await assertRevert(farmRemote.submitProxyVote(pxVoteOverMax.proxyReq, pxVoteOverMax.extra), 'seq max is 0xffffffff - this should overflow to 0 and thus fail')

    assert.deepEqual(await farmRemote.getSequenceNumber(ballotId, u1), toBigNumber(0), 'seq = 0 for u1 init')
    await farmRemote.submitVote(ballotId, genRandomBytes32(), '0x', {from: u1})
    // can vote directly twice+
    await farmRemote.submitVote(ballotId, genRandomBytes32(), '0x', {from: u1})
    assert.deepEqual(await farmRemote.getSequenceNumber(ballotId, u1), toBigNumber(0xffffffff), 'seq = 0xffffffff')
}


const testRevertConditions = async ({owner, accounts, farmPx, farmRemote, doLog}) => {
    await doLog("checking init ballots")
    await assertRevert(farmPx.initBallotProxy(toBigN(0), zeroHash, zeroHash, R.repeat(zeroHash, 4)), 'no initBallotProxy on farmPx')
    await assertRevert(farmRemote.initBallotProxy(toBigN(0), zeroHash, zeroHash, R.repeat(zeroHash, 4)), 'no initBallotProxy on farmRemote')
    await assertRevert(farmRemote.initBallot(zeroHash, toBigN(0), zeroAddr, zeroAddr, zeroAddr + "00000000"), 'no initBallot on farmRemote')
    await assertRevert(farmRemote.getCreationTs(zeroHash), 'no creationTs on farmRemote')

    await doLog("checking sponsor reverts")
    await assertRevert(farmPx.sponsor(toBigN(0)), 'no sponsor on farmPx')
    await assertRevert(farmRemote.sponsor(toBigN(0)), 'no sponsor on farmRemote')

    await doLog("checking submit vote reverts")
    await assertRevert(farmPx.submitVote(toBigN(0), zeroHash, "0x"), 'no submitVote on farmPx')
    await assertRevert(farmPx.submitProxyVote(R.repeat(zeroHash, 5), "0x"), 'no submitProxyVote on farmPx')

    await doLog("checking get vote/sponsor reverts")
    await assertRevert(farmRemote.getVote(0, 0), 'no getVote on remote farm due to not returning casting time')
    await assertRevert(farmPx.getVote(0, 0), 'no votes in farmPx 1')
    await assertRevert(farmPx.getVoteAndTime(0, 0), 'no votes in farmPx 2')
    await assertRevert(farmPx.getSequenceNumber(0, zeroAddr), 'no seqNums in farmPx')
    await assertRevert(farmPx.getTotalSponsorship(0), 'no sponsorship in farmPx 1')
    await assertRevert(farmPx.getSponsorsN(0), 'no sponsorship in farmPx 2')
    await assertRevert(farmPx.getSponsor(0, 0), 'no sponsorship in farmPx 3')
    await assertRevert(farmRemote.getTotalSponsorship(0), 'no sponsorship in farmRemote 1')
    await assertRevert(farmRemote.getSponsorsN(0), 'no sponsorship in farmRemote 2')
    await assertRevert(farmRemote.getSponsor(0, 0), 'no sponsorship in farmRemote 3')

    await doLog("checking set methods")
    await assertRevert(farmRemote.setBallotOwner(0, zeroAddr), 'cannot set owner on farmRemote')
    await assertRevert(farmRemote.setDeprecated(0), 'cannot set deprecated on farmRemote')
    await assertRevert(farmRemote.setEndTime(0, 0), 'cannot set endTime on farmRemote')
    await assertRevert(farmRemote.revealSeckey(0, zeroHash), 'cannot set secKey on farmRemote')
}


const testGetVotes = async ({owner, accounts, farmPx, farmRemote, doLog}) => {
    const ballotId = await genBallot(farmPx, owner)

    const [,u1,u2,u3] = accounts
    const getTs = async () => (await getBlock('latest')).timestamp

    const exs = R.map(i => `0x000${i}`, R.range(1, 7))
    const exsEncoded = R.map(toRlp, exs)

    await doLog(`extras and encoded: ${exs} -- ${exsEncoded}`)

    await farmRemote.submitVote(ballotId, "0x01", exs[0], {from: u1})
    const ts1 = await getTs()

    // allow us to check we can get votes after ts1
    await (new Promise((res, rej) => setTimeout(res, 1000)))

    await farmRemote.submitVote(ballotId, "0x02", exs[1], {from: u1})
    const ts2 = await getTs()
    await farmRemote.submitVote(ballotId, "0x01", exs[2], {from: u2})
    const ts3 = await getTs()
    await farmRemote.submitVote(ballotId, "0x02", exs[3], {from: u2})
    const ts4 = await getTs()
    await farmRemote.submitVote(ballotId, "0x01", exs[4], {from: u3})
    const ts5 = await getTs()
    await farmRemote.submitVote(ballotId, "0x02", exs[5], {from: u3})
    const ts6 = await getTs()

    // exclude first vote in vs1
    const vs1 = await farmRemote.getVotesBetween(ballotId, ts1 + 1, 2e9)
    // get only u1's votes in vs2
    const vs2 = await farmRemote.getVotesBetweenFor(ballotId, 0, 2e9, u1)

    const expectedVs1 = [
        R.map(b => w3.utils.padRight(b, 64), ["0x02", "0x01", "0x02", "0x01", "0x02"]),
        [u1, u2, u2, u3, u3],
        toRlp(R.slice(1, 6, exs)),
        R.map(toBigN, [ts2, ts3, ts4, ts5, ts6])
    ]

    const expectedVs2 = [
        R.map(b => w3.utils.padRight(b, 64), ["0x01", "0x02"]),
        toRlp(R.slice(0, 2, exs)),
        R.map(toBigN, [ts1, ts2])
    ]

    assert.deepEqual(vs1, expectedVs1, "vs1 matches")
    assert.deepEqual(vs2, expectedVs2, "vs2 matches")

    assert.deepEqual(fromRlp(vs1[2]), R.slice(1,6,exs), 'rlp vs1 extras decoding matches')
    assert.deepEqual(fromRlp(vs2[1]), R.slice(0,2,exs), 'rlp vs2 extras decoding matches')
}


const testMisc = async ({owner, accounts, farmPx, farmRemote, doLog}) => {
    const [,u1] = accounts
    const ballotId = await genBallot(farmPx, owner, mkPacked(0, 2e9, USE_ETH | USE_TESTING | USE_NO_ENC))

    await assertRevert(farmPx.revealSeckey(ballotId, zeroHash), "can't reveal seckey before end time")
    await farmPx.setEndTime(ballotId, 0)
    const sk = genRandomBytes32()
    assert.equal((await farmPx.getDetails(ballotId, u1))[2], zeroHash, "seckey 0 before reveal")
    await farmPx.revealSeckey(ballotId, sk)
    assert.equal((await farmPx.getDetails(ballotId, u1))[2], sk, "seckey matches after reveal")
}


function sAssertEq(a, b, msg) {
    return assert.true(S.equals(a, b), msg);
}


const _wrapTest = ({accounts}, f) => {
    return async () => {
        const owner = accounts[0]

        const Emitter = await EmitterTesting.new();
        const doLog = m => Emitter.log(m);

        await doLog("Starting test wrap")

        const farmRemote = await RemoteBBFarm.new("0x013d0001");
        await farmRemote.setPermissions(owner, true)
        const farmPx = await RemoteBBFarmPx.new("0x013d0001", 1, 61, farmRemote.address);
        await farmPx.setPermissions(owner, true)

        await doLog("Finished wrap contract deployment")


        // await doLog("Finished test wrapping - starting test now")

        return await f({owner, accounts, farmPx, farmRemote, doLog});
    };
}


contract("BBFarm Remote", function(accounts) {
    const tests = [
        ["should instantiate correctly", testInstantiation],
        ["test proxy vote", testProxyVote],
        ["test proxy vote replay attacks", testProxyVoteReplayProtection],
        ["should allow setting owner", testSetOwner],
        ["should enforce encryption based on PK submitted", testEncryptionBranching],
        ["should not allow testing functions if testing mode is false", testTestMode],
        ["should allow deprecation", testDeprecation],
        // ["test community status", testCommStatus],
        ["should have correct version", testVersion],
        ["test bad submission bits", testBadSubmissionBits],
        ["test owner", testOwner],
        ["test end time must be in future", testEndTimePast],
        ["test revert conditions", testRevertConditions],
        ["test getVotesBetween and getVotesBetweenFor", testGetVotes],
        ["test misc", testMisc],
    ]
    R.map(([desc, f]) => {
        it("BBFRemote: " + desc, _wrapTest({accounts}, f))
    }, tests);
});
