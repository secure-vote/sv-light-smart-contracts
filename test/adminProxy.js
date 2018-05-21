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
const FaucetErc20 = artifacts.require("./FaucetErc20");
const TestHelper = artifacts.require("./TestHelper")

const nh = require('eth-ens-namehash');

require("./testUtils")();

const R = require('ramda')

const wrapTestNoPrep = ({accounts}, f) => {
    return async () => {
        return await f({accounts})
    }
}

const wrapTest = ({accounts}, f) => {
    return async () => {
        const owner = accounts[0];
        const backupOwner = accounts[accounts.length - 1];

        const scLog = await EmitterTesting.new();

        // use this doLog function in the wrapper to easily turn on and off this logging
        const loggingActive = false;
        const doLog = async msg => {
            if (loggingActive)
                return await scLog.log(msg);
        }

        await doLog(`Created logger...`);

        const be = await IxBackend.new();
        await doLog(`Created backend...`);
        const payments = await IxPayments.new(backupOwner);
        await doLog(`Created payments backend...`);
        const pxF = await PxFactory.new();
        await doLog(`Created PxFactory...`);
        const bbF = await BBFactory.new();
        await doLog(`Created BBFactory...`);

        await doLog(`Set up contracts: \nbackend (${be.address}), \npaymentSettings (${payments.address}), \npxFactory (${pxF.address}), \nbbFactory (${bbF.address})`)

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

        await doLog(`Created ensPx for tld: ${tld}`)

        const ixEnsPx = await EnsOwnerPx.new(indexNH, ensRry.address, ensPR.address)
        await ensPx.regNameWOwner("index", zeroAddr, ixEnsPx.address);
        await doLog(`Created index.${tld} owner px at ${ixEnsPx.address}`)

        const svIx = await SVIndex.new(be.address, payments.address, pxF.address, bbF.address, ensPx.address, ixEnsPx.address, {gasPrice: 0});
        await doLog(`Created svIx at ${svIx.address}`)

        await ixEnsPx.setAddr(svIx.address);
        await ixEnsPx.setAdmin(svIx.address, true);
        const ixEnsResolution = await ensPR.addr(indexNH);
        await doLog(`index.${tld} now resolves to ${ixEnsResolution}`)
        assert.equal(ixEnsResolution, svIx.address, "ixEns should resolve to ix")

        await be.setPermissions(svIx.address, true);
        await be.doLockdown();

        await payments.setPermissions(svIx.address, true);
        await payments.doLockdown();

        await doLog("set permissions for backend and paymentSettings - allow svIx")

        await assertErrStatus(ERR_ADMINS_LOCKED_DOWN, be.setPermissions(svIx.address, true), "should throw error after lockdown (be)")
        await assertErrStatus(ERR_ADMINS_LOCKED_DOWN, payments.setPermissions(svIx.address, true), "should throw error after lockdown (paySC)")

        await doLog("asserted that setPermissions fails after lockdown")

        await ensPx.setAdmin(svIx.address, true);

        await doLog("added svIx as admin to ensPx")

        await doLog(`accounts[0]: ${accounts[0]}`)
        await doLog(`paySC owner: ${await payments.owner()}`)
        await doLog(`be owner:    ${await be.owner()}`)
        await doLog(`svId owner:  ${await svIx.owner()}`)

        const erc20 = await FaucetErc20.new();
        await doLog(`Created erc20 w faucet at ${erc20.address}`)

        const dInitTxR = await svIx.dInit(erc20.address, {from: owner, value: 1});
        const {args: {democHash, admin: adminPxAddr}} = getEventFromTxR("DemocAdded", dInitTxR)
        const adminPx = SVAdminPx.at(adminPxAddr)
        const ixPx = SVIndex.at(adminPxAddr)

        return await f({svIx, democHash, adminPx, ixPx, ensRry, ensRrr, ensPR, ensPx, be, pxF, bbF, tld, payments, scLog, owner, backupOwner, ixEnsPx, erc20, accounts});
    };
};


const testAdminPxInit = async ({accounts, owner, svIx, democHash, adminPx, ixPx}) => {
    assert.equal(await adminPx.owner(), owner, "owner matches")
    assert.equal(await adminPx.isProxyContract(), true, "isProxyContract is true")
    assert.equal((await adminPx.proxyVersion()).toNumber(), 2, "proxyVersion is 2")
    assert.equal(await adminPx.allowErc20OwnerClaim(), true, "allowErc20OwnerClaim is true by default")
    assert.equal(await adminPx.democHash(), democHash, "democHash matches")
    assert.equal(await adminPx.communityBallotsEnabled(), true, "community ballots on by default")
    assert.equal(await adminPx.admins(owner), true, "owner is admin by default")
    assert.equal(await adminPx._forwardTo(), svIx.address, "fwd to is ix addr")
    assert.deepEqual(await adminPx.listAllAdmins(), [owner], "listAllAdmins is just owner to start with")
}


const testListAllAdmins = async ({accounts, owner, svIx, democHash, adminPx, ixPx}) => {

    const [_, u1, u2, u3, u4, u5] = accounts;

    await assertRevert(adminPx.addAdmin(u5, {from: u1}), "can't add admins without permission")

    await adminPx.addAdmin(u5, {from: owner})
    assert.deepEqual(await adminPx.listAllAdmins(), [owner, u5], "listAllAdmins works for 2")

    await adminPx.addAdmin(u2, {from: u5})
    assert.deepEqual(await adminPx.listAllAdmins(), [owner, u5, u2], "listAllAdmins works for 3")

    await adminPx.removeAdmin(u5, {from: u2})
    assert.deepEqual(await adminPx.listAllAdmins(), [owner, u2], "listAllAdmins works after removing u5")

    await adminPx.addAdmin(u5, {from: u2})
    assert.deepEqual(await adminPx.listAllAdmins(), [owner, u5, u2, u5], "listAllAdmins works for 4 with strange ordering too (due to adminLog)")

    await assertRevert(adminPx.removeAdmin(u2, {from: u2}), "can't remove self as admin")
}


const testFwdingFallback = async ({accounts, scLog, owner, payments, svIx, democHash, adminPx, ixPx}) => {

    const [_, u1, u2, u3, u4, u5] = accounts;

    const [s, e] = genStartEndTimes()

    const _packed = mkPacked(s, e, USE_ETH | USE_NO_ENC)
    const packed = toBigNumber(_packed)
    assert.equal(_packed.toString(10), packed.toString(10), "bigNumber and BN should match as strings")

    const packedBadEndTime = toBigNumber(mkPacked(s, 0, USE_ETH | USE_NO_ENC))

    const deployBallotBadSender = ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, packed, {from: u1})
    await assertRevert(deployBallotBadSender, "does not fwd with bad sender")
    await scLog.log("Confirmed bad senders can't deploy ballots")

    // make sure the ballot deploys normally
    await ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, packed, {from: owner})
    await assertRevert(ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, packedBadEndTime, {from: owner}), "cannot deploy ballot with end time in past")
    await scLog.log("confirmed the ballot could be published only if end time in future")

    // make sure we can fwd with no data and non-admin sender
    assert.equal(await adminPx.admins(u1), false, "u1 should not be an admin")
    assert.equal(await svIx.accountInGoodStanding(democHash), false, "democ should not yet be in good standing")
    assert.equal(await payments.getSecondsRemaining(democHash), 0, "democ should have 0 seconds on it")
    await scLog.log("confirmed admins, accountStanding, and secs remaining")

    // a tx from u1 to pay for democ
    await sendTransaction({from: u1, to: adminPx.address, value: oneEth, gasPrice: 0, gas: 5000000})
    await scLog.log("payment of 1 ether made")

    const secsRemaining = await payments.getSecondsRemaining(democHash);
    const secsPerEth = await payments.weiBuysHowManySeconds(toBigNumber(oneEth));
    assert.equal(await svIx.accountInGoodStanding(democHash), true, "democ now in good standing due to 1 eth payment")
    assert.deepEqual(secsRemaining.minus(secsPerEth).abs().toNumber() < 2, true, "democ should have plenty of secs now")
    assert.equal(secsRemaining.toNumber() > 1000000, true, "secsRemaining should be more than 1 million (about 12 days)")

    // should do nothing - this checks the else part of `if (msg.value > 0)`
    await sendTransaction({from: u1, to: adminPx.address, value: 0});
}


const testFwdingManual = async ({scLog, accounts, owner, payments, svIx, democHash, adminPx, ixPx}) => {

    const [_, u1, u2, u3, u4, u5] = accounts;
    // use lots of gas
    const gas = 5000000

    await assertRevert(adminPx.fwdPayment(u2, {from: u1, value: 1, gas}), "fwd payment fails on bad sender")
    await assertRevert(adminPx.fwdData(u2, genRandomBytes32(), {from: u1, gas}), "fwd data fails on bad sender")
    await assertRevert(adminPx.fwdPaymentAndData(u2, genRandomBytes32(), {from: u1, gas, value: 1}), "fwd payment and data fails on bad sender")
    await scLog.log("confirmed fwding fails for bad permissions")

    const testHelper = await TestHelper.new({gas})
    const th = testHelper.address

    await scLog.log("about to fwd payment")
    await adminPx.fwdPayment(th, {value: 1, gas})
    await scLog.log("done fwd payment")
    assert.equal(await testHelper.justValue(adminPx.address), 1, "value recorded in test helper via px")

    const sampleData = "some data"
    const dataForTh = getData(testHelper.storeData, sampleData)
    await adminPx.fwdData(th, dataForTh, {gas})
    assert.equal(await testHelper.justData(adminPx.address), toHex(sampleData), "data recorded in test helper via px")
    await scLog.log("fwd'd data!")

    const sample2 = "more data"
    const data2 = getData(testHelper.storeDataAndValue, sample2)
    await adminPx.fwdPaymentAndData(th, data2, {value: 1337, gas})
    assert.deepEqual(await testHelper.dataAndValue(adminPx.address), [toHex(sample2), toBigNumber(1337)], "data and value recorded in test helper via px")
    await scLog.log("fwd'd payment and data!")

    const dataThrow = getData(testHelper.willThrow)
    await assertRevert(adminPx.fwdData(th, dataThrow, {gas}), "fwdData should revert when sending to `willThrow` on helper")
    await assertRevert(adminPx.fwdPayment(th, {value: 1999, gas}), "fwdPayment should revert when sending 1999 wei to helper")
    await assertRevert(adminPx.fwdPaymentAndData(th, dataThrow, {value: 9999, gas}) , "fwdPaymentAndData should revert when sending to `willThrow` on helper")
    await scLog.log("make sure fwds that revert also revert the tx in the proxy")
}


const testReentrancy = async ({accounts}) => {
    const [owner, u1, u2, u3, u4, u5] = accounts;
    // use lots of gas
    const gas = 5000000
    const freetx = {gasPrice: 0}

    const scLog = await EmitterTesting.new(freetx)
    const log = async (msg) => await scLog.log(msg, freetx);
    await log("Created scLog")

    const testHelper = await TestHelper.new(freetx)
    const th = testHelper.address
    await log("created testHelper")

    const px = await SVAdminPx.new(zeroHash, owner, th, freetx)
    const pxAddr = px.address
    await log(`Proxy address: ${px.address}`)

    // first test an expected "change" type transaction
    const halfEth = web3.toWei(0.5, "ether");
    const wholeEth = web3.toWei(1, "ether");

    const reentrancyData = getData(testHelper.reentrancyHelper, pxAddr, "", halfEth)
    await log(`Got friendly reentrancy data ${reentrancyData}`)
    await log(`About to get balance for owner (${owner})`)

    const preBal = await getBalance(owner);
    await log(`Owner balance: ${preBal.toNumber()}`)

    const txh1 = await sendTransaction({to: pxAddr, data: reentrancyData, value: wholeEth, from: owner, ...freetx})
    await log(`Sent reentrancy tx as ${txh1}`)

    const txr1 = await getTransactionReceipt(txh1);
    const tx1 = await getTransaction(txh1);
    await log(`Got tx receipt: ${toJson(txr1)}`)
    await log(`Got tx: ${toJson(tx1)}`)
    assert.equal(txr1.status, 1, "tx should succeed")

    const postBal = await getBalance(owner);

    const expectedPostBal = web3.fromWei(preBal.minus(halfEth).minus(tx1.gasPrice.times(txr1.gasUsed)), "ether")
    const postBalEther = web3.fromWei(postBal, "ether")

    const diff = web3.fromWei(preBal.minus(postBal), "ether");
    await log(`Diff in balances: ${diff.toFixed()}`)
    assert.deepEqual(postBalEther.toFixed(), expectedPostBal.toFixed(), "balances should match expected after reentrancy on fallback")

    // now test something less safe - try to trigger the safeTxMutex revert

    // set up th as admin so it can call certain methods
    await px.addAdmin(th)

    // we'll declare data from the "inside out" like some kind of onion
    // the plan is to have msgs bounce: PX.fwdData -> TH.reentrancyHelper -> PX.fwdData -> TH.storeData
    const finalData = getData(testHelper.storeData, "0x1337")
    const data1IntoPx = getData(px.fwdData, th, finalData)
    const data2IntoTH = getData(testHelper.reentrancyHelper, pxAddr, data1IntoPx, 0)
    await assertRevert(px.fwdData(th, data2IntoTH), 'should trigger the safeTxMutex')

    // the inner part should work though
    await px.fwdData(th, finalData)
    assert.equal(await testHelper.justData(pxAddr), "0x1337", "final part of reentrancy onion should be okay")
}


contract("SVLightAdminProxy", function (accounts) {
    tests = [
        ["test admin px init", testAdminPxInit],
        ["test list admins", testListAllAdmins],
        ["test fwd fallback", testFwdingFallback],
        ["test fwd manually", testFwdingManual],
        ["test reentrancy", testReentrancy, true],
    ];
    R.map(([desc, f, skip]) => it(desc, skip === true ? wrapTestNoPrep({accounts}, f) : wrapTest({accounts}, f)), tests);
});
