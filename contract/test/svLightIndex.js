const SVIndex = artifacts.require("./SVLightIndex.sol");
const SVAdminPx = artifacts.require("./SVLightAdminProxy.sol");
const SVBallotBox = artifacts.require("./SVLightBallotBox.sol");

require("./testUtils")();

const AsyncPar = require("async-parallel");

const {create, env} = require("sanctuary");
const S = create({checkTypes: true, env});

const bytes32zero =
    "0x0000000000000000000000000000000000000000000000000000000000000000";

const assert403 = (f, msg) => asyncErrStatus(403, f, msg);
const assertNoErr = (tx) => assert.eventDoesNotOccur("Error", tx);

async function testOwner(accounts) {
    const svIx = await SVIndex.new({gas: 6500000});

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
    const {args: {democHash: democId, admin: d1PxAddr}} = getEventFromTxR("DemocInit", initSomeDemocTxR);
    const d1Px = SVIndex.at(d1PxAddr);

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

    const lbb = await SVBallotBox.new(democId, [0, 0], [true, false]);
    // log("created LBB to work with... adding a ballot");

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
    const {args: {democHash: d2Hash, admin: d2PxAddr}} = getEventFromTxR("DemocInit", d2Txr);
    const d2Px = SVIndex.at(d2PxAddr)

    // make sure whitelists are still blocking ppl
    await asyncErrStatus(ERR_BAD_PAYMENT,
        () => d2Px.addBallot(d2Hash, d2Hash, lbb.address, {from: d1Admin}),
        "no free lunch (1) - fail with bad payment"
    );

    // log("confirm a[1] is admin of", democId);
    assert.equal(d1PxAddr, (await svIx.getDemocInfo(democId))[1], "admin should be d1PxAddr");
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
    const bTxr = await d1Px.deployBallot(democId, democId, bytes32zero, [0, 20000000000], [false, false], {from: d1Admin});
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


const testPayments = async (acc) => {
    const admin = acc[0];
    const userPaid = acc[1];
    const userFree = acc[2];

    const [democPrice, ballotPrice] = S.map(a => web3.toWei(a, 'ether'), [0.05, 0.01]);

    const svIx = await SVIndex.new({gas: 6500000});
    assertNoErr(await svIx.setEth([democPrice, ballotPrice], {from: admin}))
    assertNoErr(await svIx.setWhitelistDemoc(userFree, true, {from: admin}))

    await asyncErrStatus(ERR_BAD_PAYMENT, () => svIx.initDemoc("userPaidFail", {from: userPaid}), "userPaid must pay");

    // test making a payment and getting change
    const _userPaidBalPre = await getBalance(userPaid);
    const _democInitPaid = await svIx.initDemoc("userPaidGood", {from: userPaid, value: democPrice + 1337, gasPrice: 0});
    const _userPaidBalPost = await getBalance(userPaid);
    assert.isTrue(_userPaidBalPre.eq(_userPaidBalPost.add(democPrice)), "extra wei should be refunded");

    // assert event and get democId
    assertNoErr(_democInitPaid);
    getEventFromTxR("PaymentMade", _democInitPaid);
    const {args: {democHash: democId, admin: proxySC}} = getEventFromTxR("DemocInit", _democInitPaid);
    // note: this even _is_ emitted but truffle doesn't automatically process it like SVIndex events...
    // const {address: proxySC2} = getEventFromTxR("AddedAdminToPx", _democInitPaid);

    const ixPxForPaid = SVIndex.at(proxySC);
    const pxRaw = SVAdminPx.at(proxySC);

    // test a payment for democId
    await asyncErrStatus(ERR_BAD_PAYMENT, () => ixPxForPaid.deployBallot(democId, democId, democId, [0, 0], [true, true], {from: userPaid}), "userPaid can't publish issues for free");
    const _ballotTxR = await ixPxForPaid.deployBallot(democId, democId, democId, [0, 0], [true, true], {
        from: userPaid,
        value: ballotPrice
    });
    assertNoErr(_ballotTxR)
    const _ballotDeployE = getEventFromTxR("BallotInit", _ballotTxR);

    // test userFree can do this for free
    const _democFreeTxR = await svIx.initDemoc("free democ", {from: userFree});
    assertNoErr(_democFreeTxR)
    const _democFreeE = getEventFromTxR("DemocInit", _democFreeTxR);
    const _freeDemocId = _democFreeE.args.democHash;
    const ixPxForFree = SVIndex.at(_democFreeE.args.admin);
    
    // set whitelist for issues to the proxySC - not user themselves
    assertNoErr(await svIx.setWhitelistBallot(_democFreeE.args.admin, true, {from: admin}));

    assertNoErr(await ixPxForFree.deployBallot(_freeDemocId, _freeDemocId, _freeDemocId, [0, 0], [true, true], {from: userFree}))
}


contract("SVLightIndex", function (_accounts) {
    tests = [
        ["end-to-end-ish", testOwner],
        ["payment amounts", testPayments],
    ];
    S.map(([desc, f]) => it(desc, wrapTest(_accounts, f)), tests);
});
