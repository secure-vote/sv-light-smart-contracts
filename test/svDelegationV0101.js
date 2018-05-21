const DCOrig = artifacts.require("./SVDelegation.sol");
// const DCv11 = artifacts.require("./SVDelegationV0101.sol");
const DCv11 = artifacts.require("./SVDelegationV0101_1.sol");
const R = require('ramda');

require("./testUtils")();

const AsyncPar = require("async-parallel");

const {create, env} = require("sanctuary");
const S = create({checkTypes: true, env});


async function testGlobalDelegation({accounts: acc}) {
    const [v1, v2, d1, d2, t1, t2] = acc;

    const dcOrig = await DCOrig.new();
    const dc = await DCv11.new(dcOrig.address);

    assert.deepEqual([[], []], await dc.findPossibleDelegatorsOf(d2), "await dc.findPossibleDelegatorsOf(d2) returns nothing");

    await dcOrig.setTokenDelegation(t1, d2, {from: v1})
    await dcOrig.setGlobalDelegation(d2, {from: v2})

    // assert.equal(d2, (await dc.resolveDelegation(v1, t1))[3], "resolveDelegation token good #0");
    assert.equal(zeroAddr, (await dc.resolveDelegation(v1, zeroAddr))[3], "resolveDelegation Global good #0");
    // assert.equal(d2, (await dc.resolveDelegation(v2, zeroAddr))[3], "resolveDelegation Global (d2) good #0");

    // this won't be true since dc doens't know about v1 or v2 yet - though will after
    // they both make txs
    // assert.deepEqual([[v1, v2], [t1, zeroAddr]], await dc.findPossibleDelegatorsOf(d2), "await dc.findPossibleDelegatorsOf(d2) returns 2 records");

    await dc.setGlobalDelegation(d1, {from: v1});
    assert.equal(d1, (await dc.resolveDelegation(v1, zeroAddr))[3], "resolveDelegation glob good #1");
    // note: this next line (v1, t1) -> d1 is actually a bug! We set it to d2 above...
    // documentation in SVDelegationV0101_1.sol
    assert.equal(d1, (await dc.resolveDelegation(v1, t1))[3], "resolveDelegation token good #1");

    assert.deepEqual([[v1], [zeroAddr]], await dc.findPossibleDelegatorsOf(d1), "await dc.findPossibleDelegatorsOf(d1) returns one result");

    await dc.setGlobalDelegation(d1, {from: v2});
    assert.equal(d1, (await dc.resolveDelegation(v2, zeroAddr))[3], "resolveDelegation global good #1.1");

    await dc.setTokenDelegation(t1, d1, {from: v1});
    assert.equal(d1, (await dc.resolveDelegation(v1, t1))[3], "resolveDelegation tokne good #2");
    assert.equal(d1, (await dc.resolveDelegation(v1, zeroAddr))[3], "resolveDelegation global good #2");

    const votersForD1 = await dc.findPossibleDelegatorsOf(d1);
    assert.deepEqual([[v1, v2, v1], [zeroAddr, zeroAddr, t1]], votersForD1, "possible delegators matches #3 d1");

    await dc.setTokenDelegation(t2, d2, {from: v2});
    await dc.setTokenDelegation(t2, d2, {from: v1});
    const votersForD2 = await dc.findPossibleDelegatorsOf(d2);

    // (v2, zeroAddr) appears first here because old delegations are
    // done in order of [oldToken] + logTokenContracts
    assert.deepEqual([[v2, v1, v2, v1], [zeroAddr, t1, t2, t2]], votersForD2, "possible delegators matches #3 d2");
}


const testTokenDelegation = async ({accounts: acc}) => {
    const dcOrig = await DCOrig.new();
    const dc = await DCv11.new(dcOrig.address);

    const v1 = acc[0];
    const v2 = acc[1];

    const d1 = acc[2];
    const d2 = acc[3];

    const t1 = acc[4];
    const t2 = acc[5];

    await dc.setTokenDelegation(t1, d1, {from: v1});
    assert.equal(d1, (await dc._rawGetTokenDelegation(v1, t1))[3], "rawGetTokenD good");
    assert.equal(d1, (await dc.resolveDelegation(v1, t1))[3], "resolve token delegation good");
    assert.equal(zeroAddr, (await dc.resolveDelegation(v1, zeroAddr))[3], "resolve token delegation does not carry to global");
    assert.equal(zeroAddr, (await dc.resolveDelegation(d1, t1))[3], "delegate is not a voter - has no delegation");

    const hist = await dc.getHistoricalDelegation(1);
    const blockN = await getBlockN();
    const bnsToNums = xs => R.map(x => x.toNumber ? x.toNumber() : x, xs);
    assert.deepEqual(bnsToNums(hist), [1, 0, blockN, d1, v1, t1], "delegation from sc should match expected")

    await dc.setGlobalDelegation(d2, {from: v1});
    const dGlobal = await dc._rawGetGlobalDelegation(v1)
    assert.deepEqual(bnsToNums(dGlobal), [2, 0, await getBlockN(), d2, v1, zeroAddr]);

    await dc.setTokenDelegation(t2, d1, {from: v1});
    assert.equal(await dc._getLogTokenContract(0), zeroAddr, "logTokenContracts should work 1")
    assert.equal(await dc._getLogTokenContract(1), t1, "logTokenContracts should work 2")
    assert.equal(await dc._getLogTokenContract(2), t2, "logTokenContracts should work 3")

    assert.equal(await dc.getDelegationID(v1, t1), 1, "delegationID matches expected - 1");
    assert.equal((await dc.getDelegationID(v1, zeroAddr)).toNumber(), 2, "delegationID matches expected - 1.5");
    assert.equal((await dc.getDelegationID(v1, t2)).toNumber(), 3, "delegationID matches expected - 2");
    assert.equal(await dc.getDelegationID(v2, t2), 0, "delegationID 0 when not found")
};


const testDelegationMixed = async ({accounts: acc}) => {
    const dcOrig = await DCOrig.new();
    const dc = await DCv11.new(dcOrig.address);

    const v1 = acc[0];
    const v2 = acc[1];

    const d1 = acc[2];
    const d2 = acc[3];

    const t1 = acc[4];

    await dc.setTokenDelegation(t1, d1, {from: v1});
    await dc.setGlobalDelegation(d2, {from: v1});

    assert.equal(d1, (await dc._rawGetTokenDelegation(v1, t1))[3], "rawGetTokenD good");
    assert.equal(d1, (await dc.resolveDelegation(v1, t1))[3], "resolve token delegation good");
    assert.equal(d2, (await dc.resolveDelegation(v1, zeroAddr))[3], "resolve token delegation does not carry to global");
    assert.equal(zeroAddr, (await dc.resolveDelegation(d1, t1))[3], "delegate is not a voter - has no delegation");
};

const testMultiDelegations = async ({accounts: acc}) => {
    const dcOrig = await DCOrig.new();
    const dc = await DCv11.new(dcOrig.address);

    const v1 = acc[0];
    const v2 = acc[1];

    const d1 = acc[2];
    const d2 = acc[3];

    const t1 = acc[4];

    await dc.setGlobalDelegation(d1, {from: v1});
    assert.equal(d1, (await dc.resolveDelegation(v1, zeroAddr))[3], "resolveDelegation Global good D1");

    await dc.setGlobalDelegation(d2, {from: v1});
    assert.equal(d2, (await dc.resolveDelegation(v1, zeroAddr))[3], "resolveDelegation Global good D2");

    await dc.setTokenDelegation(t1, d1, {from: v1});
    assert.equal(d2, (await dc.resolveDelegation(v1, zeroAddr))[3], "resolveDelegation Global good D2");
    assert.equal(d1, (await dc.resolveDelegation(v1, t1))[3], "resolveDelegation Global good D2");
}


const testBackwardsCompatibility = async ({accounts: acc}) => {
    const [v1, v2, d1, d2, d3, d4, t1] = acc;

    const dcOrig = await DCOrig.new();
    const dc = await DCv11.new(dcOrig.address);

    await dcOrig.setTokenDelegation(t1, d1, {from: v1});
    await dcOrig.setGlobalDelegation(d2, {from: v2});
    assert.equal(d2, (await dcOrig.resolveDelegation(v2, zeroAddr))[1], "resD orig Global good d");
    assert.equal(d1, (await dcOrig.resolveDelegation(v1, t1))[1], "resD orig Token good d");
    assert.equal(d2, (await dc.resolveDelegation(v2, zeroAddr))[3], "resD Global good d");
    assert.equal(d1, (await dc.resolveDelegation(v1, t1))[3], "resD Token good d");

    // set d3 as delegate for t1 on new SC
    await dc.setTokenDelegation(t1, d3, {from: v1});
    assert.equal(d1, (await dcOrig.resolveDelegation(v1, t1))[1], "resD orig Token good d - on many SC");
    assert.equal(d3, (await dc.resolveDelegation(v1, t1))[3], "resD Token good d - on many SC");

    // try setting a new delegate on orig SC and ensure we don't pick it up on new sc
    await dcOrig.setTokenDelegation(t1, d4, {from: v1});
    assert.equal(d4, (await dcOrig.resolveDelegation(v1, t1))[1], "resD orig Token good d - on many SC #2");
    assert.equal(d3, (await dc.resolveDelegation(v1, t1))[3], "resD Token good d - on many SC #2");

    // repeat above for global
    await dcOrig.setGlobalDelegation(d2, {from: v1});
    assert.equal(d2, (await dcOrig.resolveDelegation(v1, zeroAddr))[1], "resD orig Global good - #3");
    assert.equal(d2, (await dc.resolveDelegation(v1, zeroAddr))[3], "resD global good - #3");

    await dc.setGlobalDelegation(d3, {from: v1});
    assert.equal(d2, (await dcOrig.resolveDelegation(v1, zeroAddr))[1], "resD orig Global good - #4");
    assert.equal(d3, (await dc.resolveDelegation(v1, zeroAddr))[3], "resD global good - #4");

    await dcOrig.setGlobalDelegation(d4, {from: v1});
    assert.equal(d4, (await dcOrig.resolveDelegation(v1, zeroAddr))[1], "resD orig Global good - #5");
    assert.equal(d3, (await dc.resolveDelegation(v1, zeroAddr))[3], "resD global good - #5");
}


const testRevocation = async ({accounts: acc}) => {
    const dcOrig = await DCOrig.new();
    const dc = await DCv11.new(dcOrig.address);

    const [v1, v2, d1, d2, t1] = acc;

    await dc.setTokenDelegation(t1, d1, {from: v1});
    await dc.setGlobalDelegation(d2, {from: v1});

    assert.equal(d1, (await dc.resolveDelegation(v1, t1))[3], "token delegation matches");
    assert.equal(d2, (await dc.resolveDelegation(v1, zeroAddr))[3], "token delegation matches");

    await dc.setTokenDelegation(t1, zeroAddr, {from: v1});
    assert.equal(d2, (await dc.resolveDelegation(v1, t1))[3], "token delegation resolves to global delegation after revocation");
}


const testRealV1OnMainnet = async ({accounts: acc}) => {
    if (process.env.DO_MAINNET_DELEGATION_TEST !== "true") {
        console.warn("WARNING: Skipping mainnet delegation test, use 'DO_MAINNET_DELEGATION_TEST=true' to perform this test");
        return;
    }

    const Web3Custom = require('web3');
    const myW3 = new Web3Custom(new Web3Custom.providers.HttpProvider("https://mainnet.eth.secure.vote:8545/svDelegationTests"));

    // 0x2c926cc0e63512d23a1921af78204d0de5786537 is NOT the production version of this wallet, but a test instance
    // deployed via SV hotwallet
    const newDCAddr = "0xf71ea2028e3c3fa58df8922eae6f5482123a17d4";
    const oldDCAddr = "0xd78d4beabfd3054390d10aeb4258dc2d867f5e17";
    const swmErc20Addr = "0x9e88613418cF03dCa54D6a2cf6Ad934A78C7A17A";

    // contracts on mainnet
    const origDC = new myW3.eth.Contract(DCOrig.abi, oldDCAddr);
    const newDC = new myW3.eth.Contract(DCv11.abi, newDCAddr);

    const oldLogs = [];

    log("Getting old logs...");

    let origDCFilter = origDC.allEvents({fromBlock: 5000000, toBlock: 5204019}, (e, v) => {
        if (e)
            throw Error("got error getting old logs: " + JSON.stringify(e));
        oldLogs.push(v);
    });

    log("sleeping 5s to give web3 time to get logs...");
    await (new Promise((resolve, reject) => setTimeout(resolve, 5000)));
    origDCFilter.stopWatching();

    assert.equal(46, oldLogs.length, "should have 46 old logs")

    log("Got old logs!");

    const dlgtMap = {};
    const voterToDelegate = {};
    let allVoters = [];
    let allDelegatees = [];
    const addOrInit = (d => (k, v) => {
        if (d[k] !== undefined) {
            d[k].push(v)
        } else {
            d[k] = [v];
        }
    })(dlgtMap);

    R.map(({args}) => {
        voterToDelegate[args.voter] = args.delegate;
    }, R.filter(l => l.args.tokenContract === swmErc20Addr, oldLogs));

    R.map(([v,d]) => {
        addOrInit(d,v);
        allVoters.push(v);
        allDelegatees.push(d);
    }, R.toPairs(voterToDelegate));

    allVoters = R.uniq(allVoters);
    allDelegatees = R.uniq(allDelegatees);

    // test newDC resolves delegates correctly
    let i, j;

    let fromChain;
    // test newDC can successfully run `findPossibleDelegatorsOf` including backwards compatibility
    await AsyncPar.map(allDelegatees, async d => {
        let expVoters = dlgtMap[d];
        let expTokens = new Array(expVoters.length);
        expTokens.fill(swmErc20Addr);
        fromChain = await newDC.methods.findPossibleDelegatorsOf(d).call();
        try {
            assert.deepEqual(fromChain, {0: expVoters, 1: expTokens}, "possible delegators works for newDC");
        } catch (e) {
            log(`d: ${d}, expV: ${expVoters}, expT: ${expTokens}, fromChain: ${fromChain}`);
            log(`Got error in allDelegates test for ${d}:`);
            log(e);
            throw e;
        }
        log(`Success for delegatee ${d}!`);
    }, 1);

    await AsyncPar.map(allVoters, async v => {
        let d = voterToDelegate[v];
        assert.equal((await newDC.methods.resolveDelegation(v, swmErc20Addr).call())[3], d, `voter ${v} delegates ${d}`);
        log(`passed assert for resolveDelegation: voter ${v} delegates ${d}`);
    });

    log("done testing mainnet")
}


const testKovanBackwardsCompat = async ({accounts: acc}) => {
    const tc = "0xAA62468E0668Dc9f2d5A145093cdbfa7D84E1668";
    const v1 = "0xc45797d1A7acCc9FB2DcB054Aa907f303A0a08f8";
    const v2 = "0xB4bE49829B7f70711B399c6cBfC05FcF33ff7AbE";

    const d1 = "0xB4bE49829B7f70711B399c6cBfC05FcF33ff7AbE";
    const d2 = "0xc45797d1A7acCc9FB2DcB054Aa907f303A0a08f8";
    const d3 = "0x0000000000000000000000000000000000000000";

    const Web3Custom = require('web3');
    const myW3 = new Web3Custom(new Web3Custom.providers.HttpProvider("https://kovan.eth.secure.vote:8545/svDelegationTests"));

    // 0x2c926cc0e63512d23a1921af78204d0de5786537 is NOT the production version of this wallet, but a test instance
    // deployed via SV hotwallet
    const newDCAddr = "0x8F6F18b9A83E0b42cE69783a8282441BF8F417fc";
    const oldDCAddr = "0xAA62468E0668Dc9f2d5A145093cdbfa7D84E1668";

    const newDC = new myW3.eth.Contract(DCv11.abi, newDCAddr);
    const oldDC = new myW3.eth.Contract(DCOrig.abi, oldDCAddr);

    const posVsForD1 = await newDC.methods.findPossibleDelegatorsOf(d1).call();
    // log(posVsForD1);
    const expectedPosVsForD1 = {0: [v1, v2, v2], 1: [tc, tc, zeroAddr]};

    const posVsForD2 = await newDC.methods.findPossibleDelegatorsOf(d2).call();
    const expectPosD2 = {0: [v1], 1: [tc]};
    // log(posVsForD2);
    const posVsForZero = await newDC.methods.findPossibleDelegatorsOf(zeroAddr).call();
    const expectPosZero = {0: [v1], 1: [tc]};
    // log(posVsForZero);

    const modRes = (i) => (retObj) => {
        return {
            0: retObj[0].slice(0,i),
            1: retObj[1].slice(0,i)
        }
    }

    assert.deepEqual(expectedPosVsForD1, modRes(3)(posVsForD1), `pos delegators match expected for ${d1}`);
    assert.deepEqual(expectPosD2, modRes(1)(posVsForD2), `pos delegators match expected for ${d2}`);
    assert.deepEqual(expectPosZero, modRes(1)(posVsForZero), `pos delegators match expected for ${zeroAddr}`);
}


contract("SVDelegationV0101", function (_accounts) {
    tests = [
        ["simple global delegation", testGlobalDelegation],
        ["simple token delegation", testTokenDelegation],
        ["complex global and token delegation", testDelegationMixed],
        ["multiple delegates in local and global config", testMultiDelegations],
        ["is backwards compatible", testBackwardsCompatibility],
        ["revocations resolve correctly", testRevocation],
        ["test v1 on kovan backwards compat", testKovanBackwardsCompat],
        ["test v1 on mainnet backwards compatibility", testRealV1OnMainnet]
    ];
    S.map(([desc, f]) => it(desc, wrapTest(_accounts, f)), tests);
});
