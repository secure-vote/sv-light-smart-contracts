const SVIndex = artifacts.require("./SVLightIndex");
const SVAdminPx = artifacts.require("./SVLightAdminProxy");
const SVBallotBox = artifacts.require("./SVLightBallotBox");
const BBFactory = artifacts.require("./SVBBoxFactory");
const PxFactory = artifacts.require("./SVAdminPxFactory");
const IxBackend = artifacts.require("./SVIndexBackend");
const IxPayments = artifacts.require("./SVPayments");
const EnsPx = artifacts.require("./SvEnsEverythingPx");
const EnsPR = artifacts.require("./PublicResolver");
const EnsRegistrar = artifacts.require("./SvEnsRegistrar");
const EnsRegistry = artifacts.require("./SvEnsRegistry");
const EnsOwnerPx = artifacts.require("./EnsOwnerProxy");
const EmitterTesting = artifacts.require("./EmitterTesting");

const nh = require('eth-ens-namehash');
const b58 = require('bs58');

require("./testUtils")();

const AsyncPar = require("async-parallel");

const {create, env} = require("sanctuary");
const S = create({checkTypes: true, env});


const wrapTestIx = ({accounts}, f) => {
    return async () => {
        const owner = accounts[0];
        const backupOwner = accounts[accounts.length - 1];

        const scLog = await EmitterTesting.new();

        await scLog.log(`Created logger...`);

        const be = await IxBackend.new();
        await scLog.log(`Created backend...`);
        const paySC = await IxPayments.new(backupOwner);
        await scLog.log(`Created payments backend...`);
        const pxF = await PxFactory.new();
        await scLog.log(`Created PxFactory...`);
        const bbF = await BBFactory.new();
        await scLog.log(`Created BBFactory...`);

        await scLog.log(`Set up contracts: \nbackend (${be.address}), \npaymentSettings (${paySC.address}), \npxFactory (${pxF.address}), \nbbFactory (${bbF.address})`)

        const tld = "test";
        const testLH = web3.sha3(tld);
        const testNH = nh.hash(tld);
        const indexLH = web3.sha3("index");
        const indexNH = nh.hash("index." + tld);

        const ensRry = await EnsRegistry.new();
        const ensRrr = await EnsRegistrar.new(ensRry.address, testNH);
        await ensRry.setSubnodeOwner("0x0", testLH, ensRrr.address);
        const ensPR = await EnsPR.new(ensRry.address);

        const ensPx = await EnsPx.new(ensRrr.address, ensRry.address, ensPR.address, testNH)
        await ensRrr.addAdmin(ensPx.address);

        await scLog.log(`Created ensPx for tld: ${tld}`)

        const ixEnsPx = await EnsOwnerPx.new(indexNH, ensRry.address, ensPR.address)
        await ensPx.regNameWOwner("index", zeroAddr, ixEnsPx.address);
        await scLog.log(`Created index.${tld} owner px at ${ixEnsPx.address}`)

        const svIx = await SVIndex.new(be.address, paySC.address, pxF.address, bbF.address, ensPx.address, ixEnsPx.address, {gasPrice: 0});
        await scLog.log(`Created svIx at ${svIx.address}`)

        await ixEnsPx.setAddr(svIx.address);
        await ixEnsPx.setAdmin(svIx.address, true);
        const ixEnsResolution = await ensPR.addr(indexNH);
        await scLog.log(`index.${tld} now resolves to ${ixEnsResolution}`)

        await be.setPermissions(svIx.address, true);
        await be.doLockdown();

        await paySC.setPermissions(svIx.address, true);
        await paySC.doLockdown();

        await scLog.log("set permissions for backend and paymentSettings - allow svIx")

        await assertErrStatus(ERR_ADMINS_LOCKED_DOWN, be.setPermissions(svIx.address, true), "should throw error after lockdown (be)")
        await assertErrStatus(ERR_ADMINS_LOCKED_DOWN, paySC.setPermissions(svIx.address, true), "should throw error after lockdown (paySC)")

        await scLog.log("asserted that setPermissions fails after lockdown")

        await ensPx.addAdmin(svIx.address);

        await scLog.log("added svIx as admin to ensPx")

        await scLog.log(`accounts[0]: ${accounts[0]}`)
        await scLog.log(`paySC owner: ${await paySC.owner()}`)
        await scLog.log(`be owner:    ${await be.owner()}`)
        await scLog.log(`svId owner:  ${await svIx.owner()}`)

        return await f({svIx, ensRry, ensRrr, ensPR, ensPx, be, pxF, bbF, tld, paySC, scLog, owner, backupOwner, ixEnsPx}, accounts);
    };
};


// async function testEndToEndIsh({svIx, ensPR, tld, paySC, scLog}, accounts) {
//     assert.equal(await svIx.owner(), accounts[0], "owner set");
//     assert.equal(await paySC.payTo(), accounts[0], "payTo set");
//     await scLog.log("Checked owner of svIx and payTo of paySC")

//     await assert403(paySC.setPayTo(accounts[1], {from: accounts[1]}), "only admin can set PayTo");
//     assert.equal(
//         await paySC.payTo(),
//         accounts[0],
//         "payTo can't be changed arbitrarily"
//     );
//     await scLog.log("Checked setPayTo permissions")

//     assert.equal(await svIx.paymentEnabled(), true, "payment starts false");
//     assert.equal(await paySC.paymentEnabled(), true, "payment starts false (paySC)");
//     await scLog.log("About to set payment enabled to false")
//     await paySC.setPaymentEnabled(false, {from: accounts[0]});
//     await scLog.log("Disabled payment - 10")
//     assert.equal(await svIx.paymentEnabled(), false, "payment made false");
//     assert.equal(await paySC.paymentEnabled(), false, "payment made false (paySC)");

//     await paySC.setPayTo(accounts[9], {from: accounts[0]});
//     assert.equal(await paySC.payTo(), accounts[9], "payTo changable");

//     const dPrice1 = 9876;
//     const iPrice1 = 3849;
//     await paySC.setEth([dPrice1, iPrice1], {from: accounts[0]})
//     assert.equal(await svIx.democFee(), dPrice1, "eth/democ matches");
//     assert.equal(await svIx.ballotFee(), iPrice1, "eth/issue matches");

//     await paySC.setPaymentEnabled(true, {from: accounts[0]})

//     console.log("Fees set and payment enabled.");

//     // ensure noone can set the price
//     await assert403(paySC.setEth([5, 5], {from: accounts[1]}), "setEth only by owner");
//     await assertErrStatus(
//         ERR_BAD_PAYMENT,
//         svIx.initDemoc("some democ", {from: accounts[1]}),
//         "initDemoc should fail when payment required with no payment"
//     );

//     // check payments
//     // log("mk democ okay paid");
//     const d1Admin = accounts[1];
//     const balBefore = await getBalance(d1Admin);
//     // log(await getBlockNumber())
//     const initSomeDemocTxR = await svIx.initDemoc("some democ", {
//         from: d1Admin,
//         value: dPrice1 + 456456,
//         gasPrice: 0
//     });
//     // log(await getBlockNumber())
//     // log("democCreationTx: ", democId_.tx, "---   nLogs:", democId_.logs.length);
//     const balAfter = await getBalance(d1Admin);
//     // log("balances", balBefore.toString(), balAfter.toString());
//     assert.isTrue(
//         balBefore.minus(dPrice1).eq(balAfter),
//         "payment should be accurate and remainder refunded // before: " +
//         balBefore.toString() +
//         " // after: " +
//         balAfter.toString()
//     );
//     // log("init done!");
//     const {args: {democHash: democId, admin: d1PxAddr}} = getEventFromTxR("DemocAdded", initSomeDemocTxR);
//     const d1Px = SVIndex.at(d1PxAddr);

//     await scLog.log("created SVIndex proxy d1Px");

//     const democPrefixHex = democId.slice(0, 13*2+2);
//     const prefixB32 = hexToB32(democPrefixHex.slice(2));
//     const expectedDomain = prefixB32 + '.' + tld;
//     await scLog.log(`Checking ${expectedDomain} w/ namehash ${nh.hash(expectedDomain)}`)
//     assert.equal(await ensPR.addr(nh.hash(expectedDomain)), d1PxAddr, "domain that's created should match expectation")
//     console.log("Created domain:", expectedDomain);
//     assert.equal(await svIx.democPrefixToHash(democPrefixHex), democId, "democ hash from prefix should match");

//     await scLog.log("confirmed domain creation")

//     await paySC.setPaymentEnabled(false, {from: accounts[0]})
//     assert.equal(await svIx.paymentEnabled(), false, "payment null now");

//     await scLog.log("set payment disabled - 10")

//     // check pay okay but still free fails
//     // log("mk democ not okay");
//     await paySC.setPaymentEnabled(true, {from: accounts[0]})
//     await scLog.log("set payment enabled - 11")
//     await assertErrStatus(ERR_BAD_PAYMENT,
//         svIx.initDemoc("free lunch democ (bad)", {from: d1Admin}),
//         "no free lunch (democ)"
//     );
//     await assertErrStatus(ERR_BAD_PAYMENT,
//         d1Px.addBallot(democId, democId, d1Admin, {from: d1Admin}),
//         "no free lunch (issue)"
//     );
//     // log("bad ballots over, confirming we can still make them...")

//     const lbb = await SVBallotBox.new(bytes32zero, 0, 0, USE_ETH | USE_ENC);
//     // log("created LBB to work with... adding a ballot");

//     await scLog.log("created lbb to test addBallot")

//     await assertErrStatus(ERR_BAD_PAYMENT, d1Px.addBallot(democId, bytes32zero, lbb.address, {from: d1Admin, value: iPrice1 - 1}), "payment should be too low")
//     // make sure we can still pay for a ballot though
//     await d1Px.addBallot(democId, democId, lbb.address, {from: d1Admin, value: iPrice1 + 5})
//     // log("addballot okay paid");
//     await d1Px.addBallot(democId, democId, lbb.address, {
//         from: d1Admin,
//         value: iPrice1 + 6,
//         gasPrice: 0
//     })

//     // log("ballot added!");
//     await paySC.setPaymentEnabled(false, {from: accounts[0]})
//     // log("add ballot okay free");
//     await d1Px.addBallot(democId, democId, lbb.address, {
//         from: d1Admin
//     })

//     // log("enable payments")
//     // whitelist for issues
//     await paySC.setPaymentEnabled(true, {from: accounts[0]})
//     await assertErrStatus(ERR_BAD_PAYMENT, d1Px.addBallot(democId, democId, lbb.address, {from: d1Admin}), "no free lunch (issue)");
//     // log("give someDemocAdmin whitelist access")
//     await paySC.setWhitelistBallot(d1PxAddr, true)
//     // log("accounts 1 makes ballot with no payment")
//     const bTxR1 = await d1Px.addBallot(democId, democId, lbb.address, {
//         from: d1Admin
//     });

//     await scLog.log("created bTxR1 ballot")

//     // check whitelist for democs
//     await assertErrStatus(ERR_BAD_PAYMENT,
//         svIx.initDemoc("free lunch democ (bad)", {from: d1Admin}),
//         "no free lunch democ"
//     );
//     // log("give accounts[1] democ whitelist")
//     await paySC.setWhitelistDemoc(d1Admin, true)
//     // log("confirm whitelist works")
//     const d2Txr = await svIx.initDemoc("actually free lunch (good)", {from: d1Admin})
//     const {args: {democHash: d2Hash, admin: d2PxAddr}} = getEventFromTxR("DemocAdded", d2Txr);
//     const d2Px = SVIndex.at(d2PxAddr)

//     // make sure whitelists are still blocking ppl
//     await assertErrStatus(ERR_BAD_PAYMENT,
//         d2Px.addBallot(d2Hash, d2Hash, lbb.address, {from: d1Admin}),
//         "no free lunch (1) - fail with bad payment"
//     );

//     // log("confirm a[1] is admin of", democId);
//     assert.equal(d1PxAddr, (await svIx.getAdmin(democId)), "admin should be d1PxAddr");
//     await assertErrStatus(ERR_BAD_PAYMENT,
//         svIx.initDemoc("free lunch democ (bad)", {from: accounts[2]}),
//         "no free lunch democ - acct2"
//     );

//     // log("try and deploy a ballot through the index")
//     // check we can deploy a new ballot
//     await paySC.setPaymentEnabled(false, {from: accounts[0]})
//     await scLog.log("tested some free lunch failures")

//     // get some info before hand and validate it
//     const nBallotsPre = await svIx.nBallots(democId);
//     await scLog.log(`got nBallots: ${nBallotsPre}`)
//     await assertRevert(svIx.getNthBallot(democId, nBallotsPre), "nonexistant democ will throw");

//     // log("confirmed there is not ballot there yet - deploying now")
//     const [startTime, endTime] = genStartEndTimes();
//     const packedTime = mkPackedTime(startTime, endTime)
//     await scLog.log(`About to deploy ballot with packedTime: ${packedTime.toString()} (should equal ${startTime}, ${endTime})`)
//     const bTxr = await d1Px.deployBallot(democId, democId, bytes32zero, packedTime, USE_ETH | USE_NO_ENC, 0, {from: d1Admin});
//     await scLog.log(`Deployed ballot with packed time`)
//     // log("deployed...")
//     const newBallot = await svIx.getNthBallot(democId, nBallotsPre);
//     // log("got new ballot!", newBallot);
//     assert.notEqual(bytes32zero, newBallot[0], "n+1th ballot specHash should now not be zeros");

//     // check that we can read it and all that
//     const newBallotVC = SVBallotBox.at(newBallot[2]);
//     assert.equal(newBallot[0], await newBallotVC.specHash(), "spec hashes should match as reported by LGI and LBB");
//     assert.equal(democId, await newBallotVC.specHash(), "spec hashe should match what we gave it");
//     assert.isTrue(newBallot[3].eq(await newBallotVC.startTime()), "start time should match on both ballots");
//     assert.isTrue((await newBallotVC.startTime()).toNumber() - startTime < 3, "start time matches expected (within 3s)");
//     assert.equal(endTime, (await newBallotVC.endTime()).toNumber(), "end time matches expected");
// }


// const testPayments = async ({svIx, paySC}, acc) => {
//     const admin = acc[0];
//     const userPaid = acc[1];
//     const userFree = acc[2];

//     const [democPrice, ballotPrice] = S.map(a => web3.toWei(a, 'ether'), [0.05, 0.01]);

//     await paySC.setEth([democPrice, ballotPrice], {from: admin})
//     await paySC.setWhitelistDemoc(userFree, true, {from: admin})

//     await assertErrStatus(ERR_BAD_PAYMENT, svIx.initDemoc("userPaidFail", {from: userPaid}), "userPaid must pay");

//     // test making a payment and getting change
//     const _userPaidBalPre = await getBalance(userPaid);
//     const _DemocAddedPaid = await svIx.initDemoc("userPaidGood", {from: userPaid, value: democPrice + 1337, gasPrice: 0});
//     const _userPaidBalPost = await getBalance(userPaid);
//     assert.isTrue(_userPaidBalPre.eq(_userPaidBalPost.add(democPrice)), "extra wei should be refunded");

//     // assert event and get democId
//     getEventFromTxR("PaymentMade", _DemocAddedPaid);
//     const {args: {democHash: democId, admin: proxySC}} = getEventFromTxR("DemocAdded", _DemocAddedPaid);
//     // note: this even _is_ emitted but truffle doesn't automatically process it like SVIndex events...
//     // const {address: proxySC2} = getEventFromTxR("AddedAdminToPx", _DemocAddedPaid);

//     const ixPxForPaid = SVIndex.at(proxySC);
//     const pxRaw = SVAdminPx.at(proxySC);

//     // test a payment for democId
//     await assertErrStatus(ERR_BAD_PAYMENT, ixPxForPaid.deployBallot(democId, democId, democId, mkPackedTime(0, 0), USE_ETH | USE_ENC, 0, {from: userPaid}), "userPaid can't publish issues for free");
//     const _ballotTxR = await ixPxForPaid.deployBallot(democId, democId, democId, mkPackedTime(0, 0), USE_ETH | USE_ENC, 0, {
//         from: userPaid,
//         value: ballotPrice
//     });
//     const _ballotDeployE = getEventFromTxR("BallotAdded", _ballotTxR);

//     // test userFree can do this for free
//     const _democFreeTxR = await svIx.initDemoc("free democ", {from: userFree});
//     const _democFreeE = getEventFromTxR("DemocAdded", _democFreeTxR);
//     const _freeDemocId = _democFreeE.args.democHash;
//     const ixPxForFree = SVIndex.at(_democFreeE.args.admin);

//     // set whitelist for issues to the proxySC - not user themselves
//     await paySC.setWhitelistBallot(_democFreeE.args.admin, true, {from: admin});

//     await ixPxForFree.deployBallot(_freeDemocId, _freeDemocId, _freeDemocId, mkPackedTime(0, 0), USE_ETH | USE_ENC, 0, {from: userFree})
// }


// const testUpgrade = async ({svIx, ensPx, paySC, scLog}, acc) => {
//     const svIx1 = svIx;
//     const bbF = await svIx1.bbFactory();
//     const pxF = await svIx1.adminPxFactory();
//     const be = await svIx1.backend();

//     await paySC.setPaymentEnabled(false);

//     const _tx1o1 = await svIx1.initDemoc("democ1");
//     const {args: {democHash, admin: pxAddr}} = getEventFromTxR("DemocAdded", _tx1o1);

//     // let's make sure we can make a ballot still
//     const svPx = SVIndex.at(pxAddr);
//     const _tx1o2 = await svPx.deployBallot(democHash, bytes32zero, bytes32zero, mkPackedTime(0, 0), USE_ETH | USE_ENC, 0);

//     await scLog.log("deployed _tx1o2 ballot")

//     const svIx2 = await SVIndex.new(be, paySC.address, pxF, bbF, ensPx.address, {gas: 6000000});
//     assert.equal((await svIx2.nDemocs()).toNumber(), 1, "should have 1 democ");  // note - okay to use Ix2 here bc we aren't doing any writing yet

//     await scLog.log("Created democ 2");

//     await ensPx.addAdmin(svIx2.address);
//     await scLog.log("added svIx2 to ensPx admin");

//     _txUpgrade = await svIx1.doUpgrade(svIx2.address);
//     await scLog.log("did upgrade for svIx1 -> svIx2");

//     await paySC.setPaymentEnabled(true);
//     await asyncAssertThrow(() => svIx1.initDemoc("democ2"), "Should throw on trying to init democ");
//     // const _tx2o1 = await svIx1.deployBallot(democHash, bytes32zero, bytes32zero, mkPackedTime(0, 0), USE_ENC | USE_ETH);
//     // await assertErrStatus(ERR_NO_EDIT_PERMISSIONS, _tx2o1, "svIx1 should not have edit perms anymore")

//     await paySC.setPaymentEnabled(false);

//     const _tx2o3 = await svPx.deployBallot(democHash, bytes32zero, bytes32zero, mkPackedTime(0, 0), USE_ETH | USE_ENC, 0);

//     const _tx2o2 = await svIx2.initDemoc("democ2");

//     assert.equal((await svIx2.nDemocs()).toNumber(), 2, "should have 2 democs");  // note - okay to use Ix2 here bc we aren't doing any writing yet
// }



const testUpgrade = async ({svIx, ensPx, paySC, be, ixEnsPx, owner, pxF, bbF}) => {
    // test that upgrades to new Indexes work

    /**
     * Things to test:
     * internal upgrade pointer
     * upgrading backend permissions
     * payment perms
     * ensPx perms
     * ensOwnerPx
     */

    const newIx = await SVIndex.new(be.address, paySC.address, pxF.address, bbF.address, ensPx.address, ixEnsPx.address);

    await svIx.doUpgrade(newIx.address);

    await assertRevert(svIx.doUpgrade(zeroAddr), "upgrade cannot be performed twice");

    assert.equal(await be.hasPermissions(newIx.address), true, "new ix should have BE permissions");
    assert.equal(await paySC.hasPermissions(newIx.address), true, "new ix should have payments permissions");
    assert.equal(await ensPx.admins(newIx.address), true, "new ix should have ensPx permissions");
    assert.equal(await ixEnsPx.isAdmin(newIx.address), true, "new ix should have ixEnsPx permissions");

    assert.equal(await be.hasPermissions(svIx.address), false, "old ix should not have BE permissions");
    assert.equal(await paySC.hasPermissions(svIx.address), false, "old ix should not have payments permissions");
    assert.equal(await ensPx.admins(svIx.address), false, "old ix should not have ensPx permissions");
    assert.equal(await ixEnsPx.isAdmin(svIx.address), false, "old ix should not have ixEnsPx permissions");

    assert.equal(await svIx.getUpgradePointer(), newIx.address, "svIx.getUpgradePointer should point to new ix");
}


const testInit = async () => {
    // just test the initialization params and sanity check
    throw Error('not implemented');
}


const testCreateDemoc = async () => {
    // todo: test domain stuff here
    throw Error('not implemented');
}


const testPaymentsForDemoc = async ({}) => {
    // test that payments behave as expected

    // TODO: test payments with and without gas direct to SVPayments
    // todo: test account in good standing
    throw Error('not implemented');
}


const testSVDemocCreation = async () => {
    throw Error('not implemented');

}


const testDemocAdminPermissions = async () => {
    throw Error('not implemented');

}


const testCommunityBallots = async () => {
    // test in cases we have a community instance and in cases where
    // they're enabled on a paying democ

    // todo: ensure we're setting the right submission bits on the ballot
    // when doing community ballots. (i.e. IS_OFFICIAL and IS_BINDING both false)
    throw Error('not implemented');
}


const testCommunityBallotsNonPayment = async () => {
    // test community ballots in the case a democ's payment runs out
    throw Error('not implemented');
}


const testNoCommunityBallots = async () => {
    // ensure that community ballots don't work when we have an active
    // democ that disables them
    throw Error('not implemented');
}


const testCurrencyConversion = async () => {
    // test our payment code around eth/usd stuff
    throw Error('not implemented');
}


const testPremiumUpgradeDowngrade = async () => {
    throw Error('not implemented');

}


const testCatagoriesCrud = async () => {
    // test our ability to create and deprecate catagories
    throw Error('not implemented');
}


const testSetBackends = async () => {
    // test ability to set backends dynamically
    throw Error('not implemented');
}


const testSponsorshipOfCommunityBallots = async () => {
    throw Error('not implemented');
}


const testVersion = async ({svIx}) => {
    assert.equal(2, await svIx.getVersion(), "expect version to be 2");
}


const testEnsSelfManagement = async () => {
    // test we can set and upgrade ENS via upgrades and permissions work out
    throw Error("not implemented");
}


const testNFPTierAndPayments = async () => {
    // test that we can give and remove time on NFP accounts
    throw Error("not implemented");
}


const testPaymentsBackupAdmin = async () => {
    throw Error("not implemented")
}


contract("SVLightIndex", function (accounts) {
    tests = [
        ["test upgrade", testUpgrade],
        ["test instantiation", testInit],
        ["test creating democ", testCreateDemoc],
        ["test payments for democ", testPaymentsForDemoc],
        ["test SV democ creation", testSVDemocCreation],
        ["test democ admin permissions", testDemocAdminPermissions],
        ["test community ballots (default)", testCommunityBallots],
        ["test community ballots (nonpayment)", testCommunityBallotsNonPayment],
        ["test deny community ballots", testNoCommunityBallots],
        ["test sponsorship of community ballots", testSponsorshipOfCommunityBallots],
        ["test currency conversion", testCurrencyConversion],
        ["test premium upgrade and downgrade", testPremiumUpgradeDowngrade],
        ["test catagories (crud)", testCatagoriesCrud],
        ["test setting payment + backend", testSetBackends],
        ["test version", testVersion],
        ["test ens self-management", testEnsSelfManagement],
        ["test nfp tier", testNFPTierAndPayments],
        ["test payments backup admin", testPaymentsBackupAdmin],
    ];
    S.map(([desc, f]) => it(desc, wrapTestIx({accounts}, f)), tests);
});
