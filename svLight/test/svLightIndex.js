const SVIndex = artifacts.require("./SVLightIndex.sol");
const SVAdminPx = artifacts.require("./SVLightAdminProxy.sol");
const SVBallotBox = artifacts.require("./SVLightBallotBox.sol");
const BBFactory = artifacts.require("./SVBBoxFactory.sol");
const PxFactory = artifacts.require("./SVAdminPxFactory.sol");
const IxBackend = artifacts.require("./SVIndexBackend.sol");
const EnsPx = artifacts.require("./SvEnsEverythingPx.sol");
const EnsPR = artifacts.require("./PublicResolver.sol");
const EnsRegistrar = artifacts.require("./SvEnsRegistrar.sol");
const EnsRegistry = artifacts.require("./SvEnsRegistry.sol");

const nh = require('eth-ens-namehash');

require("./testUtils")();

const AsyncPar = require("async-parallel");

const {create, env} = require("sanctuary");
const S = create({checkTypes: true, env});


const wrapTestIx = (accounts, f) => {
    return async () => {
        const be = await IxBackend.new();
        const pxF = await PxFactory.new();
        const bbF = await BBFactory.new();

        const tld = "test";
        const testLH = web3.sha3(tld);
        const testNH = nh.hash(tld);
        const ensRry = await EnsRegistry.new();
        const ensRrr = await EnsRegistrar.new(ensRry.address, testNH);
        await ensRry.setSubnodeOwner("0x0", testLH, ensRrr.address);
        const ensPR = await EnsPR.new(ensRry.address);

        const ensPx = await EnsPx.new(ensRrr.address, ensRry.address, ensPR.address, testNH)
        await ensRrr.addAdmin(ensPx.address);

        const svIx = await SVIndex.new(be.address, pxF.address, bbF.address, ensPx.address);
        await be.setPermissions(svIx.address, true);
        await be.doLockdown();
        assertErrStatus(ERR_ADMINS_LOCKED_DOWN, await be.setPermissions(svIx.address, true), "should throw error after lockdown")

        await ensPx.addAdmin(svIx.address);

        return await f({svIx, ensRry, ensRrr, ensPR, ensPx, be, pxF, bbF, tld}, accounts);
    };
};


async function testEndToEndIsh({svIx, ensPR, tld}, accounts) {
    assert.equal(await svIx.owner(), accounts[0], "owner set");
    assert.equal(await svIx.payTo(), accounts[0], "payTo set");

    await assert403(() => svIx.setPayTo(accounts[1], {from: accounts[1]}), "only admin can set PayTo");
    assert.equal(
        await svIx.payTo(),
        accounts[0],
        "payTo can't be changed arbitrarily"
    );

    assert.equal(await svIx.paymentEnabled(), true, "payment starts false");
    assertNoErr(await svIx.setPaymentEnabled(false, {from: accounts[0]}));
    assert.equal(await svIx.paymentEnabled(), false, "payment made false");

    assertNoErr(await svIx.setPayTo(accounts[10], {from: accounts[0]}));
    assert.equal(await svIx.payTo(), accounts[10], "payTo changable");

    const dPrice1 = 9876;
    const iPrice1 = 3849;
    assertNoErr(await svIx.setEth([dPrice1, iPrice1], {from: accounts[0]}))
    assert.equal(await svIx.democFee(), dPrice1, "eth/democ matches");
    assert.equal(await svIx.ballotFee(), iPrice1, "eth/issue matches");

    assertNoErr(await svIx.setPaymentEnabled(true, {from: accounts[0]}))

    console.log("Fees set and payment enabled.");

    // ensure noone can set the price
    await assert403(
        () => svIx.setEth([5, 5], {from: accounts[1]}),
        "setEth only by owner"
    );
    await asyncErrStatus(ERR_BAD_PAYMENT,
        () => svIx.initDemoc("some democ", {from: accounts[1]}),
        "initDemoc should fail when payment required with no payment"
    );

    // check payments
    // log("mk democ okay paid");
    const d1Admin = accounts[1];
    const balBefore = await getBalance(d1Admin);
    // log(await getBlockNumber())
    const initSomeDemocTxR = await svIx.initDemoc("some democ", {
        from: d1Admin,
        value: dPrice1 + 456456,
        gasPrice: 0
    });
    assertNoErr(initSomeDemocTxR)
    // log(await getBlockNumber())
    // log("democCreationTx: ", democId_.tx, "---   nLogs:", democId_.logs.length);
    const balAfter = await getBalance(d1Admin);
    // log("balances", balBefore.toString(), balAfter.toString());
    assert.isTrue(
        balBefore.minus(dPrice1).eq(balAfter),
        "payment should be accurate and remainder refunded // before: " +
        balBefore.toString() +
        " // after: " +
        balAfter.toString()
    );
    // log("init done!");
    const {args: {democHash: democId, admin: d1PxAddr}} = getEventFromTxR("DemocAdded", initSomeDemocTxR);
    const d1Px = SVIndex.at(d1PxAddr);

    const democPrefixHex = democId.slice(0,13*2+2);
    const democPrefixInt = web3.toBigNumber(democPrefixHex).toString(10);
    const expectedDomain = democPrefixInt + '.' + tld;
    assert.equal(await ensPR.addr(nh.hash(expectedDomain)), "0x00000000000000" + democPrefixHex.slice(2), "domain that's created should match expectation")
    console.log("Created domain:", expectedDomain);
    assert.equal(await svIx.democPrefixToHash(democPrefixHex), democId, "democ hash from prefix should match");

    assertNoErr(await svIx.setPaymentEnabled(false, {from: accounts[0]}))
    assert.equal(await svIx.paymentEnabled(), false, "payment null now");

    // check pay okay but still free fails
    // log("mk democ not okay");
    assertNoErr(await svIx.setPaymentEnabled(true, {from: accounts[0]}))
    await asyncErrStatus(ERR_BAD_PAYMENT,
        () => svIx.initDemoc("free lunch democ (bad)", {from: d1Admin}),
        "no free lunch (democ)"
    );
    await asyncErrStatus(ERR_BAD_PAYMENT,
        () => d1Px.addBallot(democId, democId, d1Admin, {from: d1Admin}),
        "no free lunch (issue)"
    );
    // log("bad ballots over, confirming we can still make them...")

    const lbb = await SVBallotBox.new(bytes32zero, 0, 0, USE_ETH | USE_ENC);
    // log("created LBB to work with... adding a ballot");

    assertErrStatus(ERR_BAD_PAYMENT, await d1Px.addBallot(democId, bytes32zero, lbb.address, {from: d1Admin, value: iPrice1 - 1}), "payment should be too low")
    // make sure we can still pay for a ballot though
    assertNoErr(await d1Px.addBallot(democId, democId, lbb.address, {from: d1Admin, value: iPrice1 + 5}))
    // log("addballot okay paid");
    assertNoErr(await d1Px.addBallot(democId, democId, lbb.address, {
        from: d1Admin,
        value: iPrice1 + 6,
        gasPrice: 0
    }))

    // log("ballot added!");
    assertNoErr(await svIx.setPaymentEnabled(false, {from: accounts[0]}))
    // log("add ballot okay free");
    assertNoErr(await d1Px.addBallot(democId, democId, lbb.address, {
        from: d1Admin
    }))

    // log("enable payments")
    // whitelist for issues
    assertNoErr(await svIx.setPaymentEnabled(true, {from: accounts[0]}))
    await asyncErrStatus(ERR_BAD_PAYMENT,
        () =>
            d1Px.addBallot(democId, democId, lbb.address, {
                from: d1Admin
            }),
        "no free lunch (issue)"
    );
    // log("give someDemocAdmin whitelist access")
    assertNoErr(await svIx.setWhitelistBallot(d1PxAddr, true))
    // log("accounts 1 makes ballot with no payment")
    const bTxR1 = await d1Px.addBallot(democId, democId, lbb.address, {
        from: d1Admin
    });
    assertNoErr(bTxR1);

    // check whitelist for democs
    await asyncErrStatus(ERR_BAD_PAYMENT,
        () => svIx.initDemoc("free lunch democ (bad)", {from: d1Admin}),
        "no free lunch democ"
    );
    // log("give accounts[1] democ whitelist")
    assertNoErr(await svIx.setWhitelistDemoc(d1Admin, true))
    // log("confirm whitelist works")
    const d2Txr = await svIx.initDemoc("actually free lunch (good)", {from: d1Admin})
    assertNoErr(d2Txr);
    const {args: {democHash: d2Hash, admin: d2PxAddr}} = getEventFromTxR("DemocAdded", d2Txr);
    const d2Px = SVIndex.at(d2PxAddr)

    // make sure whitelists are still blocking ppl
    await asyncErrStatus(ERR_BAD_PAYMENT,
        () => d2Px.addBallot(d2Hash, d2Hash, lbb.address, {from: d1Admin}),
        "no free lunch (1) - fail with bad payment"
    );

    // log("confirm a[1] is admin of", democId);
    assert.equal(d1PxAddr, (await svIx.getAdmin(democId)), "admin should be d1PxAddr");
    await asyncErrStatus(ERR_BAD_PAYMENT,
        () => svIx.initDemoc("free lunch democ (bad)", {from: accounts[2]}),
        "no free lunch democ - acct2"
    );

    // log("try and deploy a ballot through the index")
    // check we can deploy a new ballot
    await svIx.setPaymentEnabled(false, {from: accounts[0]})
    // get some info before hand and validate it
    const nBallotsPre = await svIx.nBallots(democId);
    // log("got pre-deploy nBallots", nBallotsPre.toNumber());
    await asyncAssertThrow(() => svIx.getNthBallot(democId, nBallotsPre), "nonexistant democ will throw");

    // log("confirmed there is not ballot there yet - deploying now")
    const bTxr = await d1Px.deployBallot(democId, democId, bytes32zero, 0, 20000000000, USE_ETH | USE_NO_ENC, {from: d1Admin});
    assertNoErr(bTxr);
    // log("deployed...")
    const newBallot = await svIx.getNthBallot(democId, nBallotsPre);
    // log("got new ballot!", newBallot);
    assert.notEqual(bytes32zero, newBallot[0], "n+1th ballot should now not be zeros");

    // check that we can read it and all that
    const newBallotVC = SVBallotBox.at(newBallot[2]);
    assert.equal(newBallot[0], await newBallotVC.specHash(), "spec hashes should match as reported by LGI and LBB");
    assert.equal(democId, await newBallotVC.specHash(), "spec hashe should match what we gave it");
    assert.isTrue(newBallot[3].eq(await newBallotVC.startTime()), "start time should match on both ballots");
}


const testPayments = async ({svIx}, acc) => {
    const admin = acc[0];
    const userPaid = acc[1];
    const userFree = acc[2];

    const [democPrice, ballotPrice] = S.map(a => web3.toWei(a, 'ether'), [0.05, 0.01]);

    assertNoErr(await svIx.setEth([democPrice, ballotPrice], {from: admin}))
    assertNoErr(await svIx.setWhitelistDemoc(userFree, true, {from: admin}))

    await asyncErrStatus(ERR_BAD_PAYMENT, () => svIx.initDemoc("userPaidFail", {from: userPaid}), "userPaid must pay");

    // test making a payment and getting change
    const _userPaidBalPre = await getBalance(userPaid);
    const _DemocAddedPaid = await svIx.initDemoc("userPaidGood", {from: userPaid, value: democPrice + 1337, gasPrice: 0});
    const _userPaidBalPost = await getBalance(userPaid);
    assert.isTrue(_userPaidBalPre.eq(_userPaidBalPost.add(democPrice)), "extra wei should be refunded");

    // assert event and get democId
    assertNoErr(_DemocAddedPaid);
    getEventFromTxR("PaymentMade", _DemocAddedPaid);
    const {args: {democHash: democId, admin: proxySC}} = getEventFromTxR("DemocAdded", _DemocAddedPaid);
    // note: this even _is_ emitted but truffle doesn't automatically process it like SVIndex events...
    // const {address: proxySC2} = getEventFromTxR("AddedAdminToPx", _DemocAddedPaid);

    const ixPxForPaid = SVIndex.at(proxySC);
    const pxRaw = SVAdminPx.at(proxySC);

    // test a payment for democId
    await asyncErrStatus(ERR_BAD_PAYMENT, () => ixPxForPaid.deployBallot(democId, democId, democId, 0, 0, USE_ETH | USE_ENC, {from: userPaid}), "userPaid can't publish issues for free");
    const _ballotTxR = await ixPxForPaid.deployBallot(democId, democId, democId, 0, 0, USE_ETH | USE_ENC, {
        from: userPaid,
        value: ballotPrice
    });
    assertNoErr(_ballotTxR)
    const _ballotDeployE = getEventFromTxR("BallotAdded", _ballotTxR);

    // test userFree can do this for free
    const _democFreeTxR = await svIx.initDemoc("free democ", {from: userFree});
    assertNoErr(_democFreeTxR)
    const _democFreeE = getEventFromTxR("DemocAdded", _democFreeTxR);
    const _freeDemocId = _democFreeE.args.democHash;
    const ixPxForFree = SVIndex.at(_democFreeE.args.admin);

    // set whitelist for issues to the proxySC - not user themselves
    assertNoErr(await svIx.setWhitelistBallot(_democFreeE.args.admin, true, {from: admin}));

    assertNoErr(await ixPxForFree.deployBallot(_freeDemocId, _freeDemocId, _freeDemocId, 0, 0, USE_ETH | USE_ENC, {from: userFree}))
}


const testUpgrade = async ({svIx, ensPx}, acc) => {
    const svIx1 = svIx;
    const bbF = await svIx1.bbFactory();
    const pxF = await svIx1.adminPxFactory();
    const be = await svIx1.backend();

    await svIx1.setPaymentEnabled(false);

    const _tx1o1 = await svIx1.initDemoc("democ1");
    const {args: {democHash, admin: pxAddr}} = getEventFromTxR("DemocAdded", _tx1o1);
    assertNoErr(_tx1o1);

    // let's make sure we can make a ballot still
    const svPx = SVIndex.at(pxAddr);
    const _tx1o2 = await svPx.deployBallot(democHash, bytes32zero, bytes32zero, 0, 0, USE_ETH | USE_ENC);
    assertNoErr(_tx1o2);

    const svIx2 = await SVIndex.new(be, pxF, bbF, ensPx.address);
    assert.equal((await svIx2.nDemocs()).toNumber(), 1, "should have 1 democ");  // note - okay to use Ix2 here bc we aren't doing any writing yet

    await ensPx.addAdmin(svIx2.address);

    _txUpgrade = await svIx1.doUpgrade(svIx2.address);
    assertNoErr(_txUpgrade);

    await asyncAssertThrow(() => svIx1.initDemoc("democ2"), "Should throw on trying to init democ");
    // const _tx2o1 = await svIx1.deployBallot(democHash, bytes32zero, bytes32zero, 0, 0, USE_ENC | USE_ETH);
    // assertErrStatus(ERR_NO_EDIT_PERMISSIONS, _tx2o1, "svIx1 should not have edit perms anymore")

    await svIx2.setPaymentEnabled(false);

    const _tx2o3 = await svPx.deployBallot(democHash, bytes32zero, bytes32zero, 0, 0, USE_ETH | USE_ENC);
    assertNoErr(_tx2o3);

    const _tx2o2 = await svIx2.initDemoc("democ2");
    assertNoErr(_tx2o2);

    assert.equal((await svIx2.nDemocs()).toNumber(), 2, "should have 2 democs");  // note - okay to use Ix2 here bc we aren't doing any writing yet
}


contract("SVLightIndex", function (_accounts) {
    tests = [
        ["end-to-end-ish", testEndToEndIsh],
        ["payment amounts", testPayments],
        ["upgrade works", testUpgrade],
    ];
    S.map(([desc, f]) => it(desc, wrapTestIx(_accounts, f)), tests);
});
