const SVIndex = artifacts.require("./SVLightIndex");
const SVAdminPx = artifacts.require("./SVLightAdminProxy");
const PxFactory = artifacts.require("./SVAdminPxFactory");
const IxBackend = artifacts.require("./SVIndexBackend");
const IxPayments = artifacts.require("./SVPayments");
const EnsPx = artifacts.require("./SvEnsEverythingPx");
const EnsPR = artifacts.require("./PublicResolver");
const EnsRegistrar = artifacts.require("./SvEnsRegistrar");
const EnsRegistry = artifacts.require("./SvEnsRegistry");
const EnsOwnerPx = artifacts.require("./EnsOwnerProxy");
const EmitterTesting = artifacts.require("./EmitterTesting");
const TestHelper = artifacts.require("./TestHelper");
const FaucetErc20 = artifacts.require("./FaucetErc20");
const BBFarm = artifacts.require("./BBFarm")

const nh = require('eth-ens-namehash');

require("./testUtils")();

const AsyncPar = require("async-parallel");

const {create, env} = require("sanctuary");
const S = create({checkTypes: true, env});


const wrapTestIx = ({accounts}, f) => {
    return async () => {
        const owner = accounts[0];
        const backupOwner = accounts[accounts.length - 1];

        const scLog = await EmitterTesting.new();

        // use this doLog function in the wrapper to easily turn on and off this logging
        let loggingActive = true;
        const doLog = async msg => {
            if (loggingActive)
                return await scLog.log(msg, {gasPrice: 0});
            return;
        }

        await doLog(`Created logger...`);

        const bbFarm = await BBFarm.new();
        await doLog(`created bbfarm`)

        const be = await IxBackend.new();
        await doLog(`Created backend...`);
        const paySC = await IxPayments.new(backupOwner);
        await doLog(`Created payments backend...`);
        const pxF = await PxFactory.new();
        await doLog(`Created PxFactory...`);

        await doLog(`Set up contracts: \nbackend (${be.address}), \npaymentSettings (${paySC.address}), \npxFactory (${pxF.address})`)

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

        const svIx = await SVIndex.new(be.address, paySC.address, pxF.address, ensPx.address, ixEnsPx.address, bbFarm.address, {gasPrice: 0});
        await doLog(`Created svIx at ${svIx.address}`)

        await ixEnsPx.setAddr(svIx.address);
        await ixEnsPx.setAdmin(svIx.address, true);
        const ixEnsResolution = await ensPR.addr(indexNH);
        await doLog(`index.${tld} now resolves to ${ixEnsResolution}`)
        assert.equal(ixEnsResolution, svIx.address, "ixEns should resolve to ix")

        await be.setPermissions(svIx.address, true);
        await be.doLockdown();

        await bbFarm.setPermissions(svIx.address, true);

        await paySC.setPermissions(svIx.address, true);
        await paySC.doLockdown();

        await doLog("set permissions for backend and paymentSettings - allow svIx")

        await assertErrStatus(ERR_ADMINS_LOCKED_DOWN, be.setPermissions(svIx.address, true), "should throw error after lockdown (be)")
        await assertErrStatus(ERR_ADMINS_LOCKED_DOWN, paySC.setPermissions(svIx.address, true), "should throw error after lockdown (paySC)")

        await doLog("asserted that setPermissions fails after lockdown")

        await ensPx.setAdmin(svIx.address, true);

        await doLog("added svIx as admin to ensPx")

        await doLog(`accounts[0]: ${accounts[0]}`)
        await doLog(`paySC owner: ${await paySC.owner()}`)
        await doLog(`be owner:    ${await be.owner()}`)
        await doLog(`svId owner:  ${await svIx.owner()}`)

        const erc20 = await FaucetErc20.new();
        await doLog(`Created erc20 w faucet at ${erc20.address}`)

        await doLog('>>> FINISHED SETUP <<<')

        loggingActive = true;
        return await f({svIx, ensRry, ensRrr, ensPR, ensPx, be, pxF, bbFarm, tld, paySC, scLog, doLog, owner, backupOwner, ixEnsPx, erc20, accounts}, accounts);
    };
};


/* UTILITY FUNCTIONS */

const mkDemoc = async ({svIx, txOpts, erc20}) => {
    assert.equal(txOpts.value && txOpts.value > 0, true, "must have value when making democ")
    const createTx = await svIx.dInit(erc20.address, txOpts);
    const {args: {democHash, admin: pxAddr}} = getEventFromTxR("DemocAdminSet", createTx);
    const adminPx = SVAdminPx.at(pxAddr);
    const ixPx = SVIndex.at(pxAddr);

    return {democHash, adminPx, ixPx};
}


/* ACTUAL TESTS */

const testUpgrade = async ({svIx, ensPx, paySC, be, ixEnsPx, pxF, bbFarm, owner, erc20, doLog}) => {
    // test that upgrades to new Indexes work

    /**
     * Things to test:
     * internal upgrade pointer
     * upgrading backend permissions
     * payment perms
     * ensPx perms
     * ensOwnerPx
     * after upgrade does a proxy find the new Ix?
     */

    // some prep so we can confirm the adminPx's upgradePtr works
    const {args: {democHash, admin}} = getEventFromTxR("DemocAdminSet", await svIx.dInit(erc20.address, {from: owner, value: 1}))
    const adminPx = SVAdminPx.at(admin);
    const ixPx = SVIndex.at(admin);
    assert.equal(await adminPx._forwardTo(), svIx.address, "adminPx fwdTo matches init")

    // upgrade proper
    const newIx = await SVIndex.new(be.address, paySC.address, pxF.address, ensPx.address, ixEnsPx.address, bbFarm.address);

    await svIx.doUpgrade(newIx.address);

    await assertRevert(svIx.doUpgrade(zeroAddr), "upgrade cannot be performed twice");

    assert.equal(await be.hasPermissions(newIx.address), true, "new ix should have BE permissions");
    assert.equal(await paySC.hasPermissions(newIx.address), true, "new ix should have payments permissions");
    assert.equal(await bbFarm.hasPermissions(newIx.address), true, "new ix should have bbfarm permissions");
    assert.equal(await ensPx.isAdmin(newIx.address), true, "new ix should have ensPx permissions");
    assert.equal(await ixEnsPx.isAdmin(newIx.address), true, "new ix should have ixEnsPx permissions");

    assert.equal(await be.hasPermissions(svIx.address), false, "old ix should not have BE permissions");
    assert.equal(await paySC.hasPermissions(svIx.address), false, "old ix should not have payments permissions");
    assert.equal(await bbFarm.hasPermissions(svIx.address), false, "old ix should not have bbfarm permissions");
    assert.equal(await ensPx.isAdmin(svIx.address), false, "old ix should not have ensPx permissions");
    assert.equal(await ixEnsPx.isAdmin(svIx.address), false, "old ix should not have ixEnsPx permissions");

    assert.equal(await svIx.getUpgradePointer(), newIx.address, "svIx.getUpgradePointer should point to new ix");

    // now test the adminPx and make sure that fwds to new democ
    assert.equal(await adminPx._forwardTo(), svIx.address, "adminPx fwdTo still matches init")
    await doLog('Going to perform an operation through ixPx to verify auto fwdTo upgrade')
    await ixPx.dSetArbitraryData(democHash, 123, 456);
    assert.equal(await adminPx._forwardTo(), newIx.address, "adminPx fwdTo upgrades automagically when sending after upgrade")
}


const testInit = async ({paySC, owner, svIx, erc20, doLog, be}) => {
    // just test the initialization params and sanity check

    assert.equal(await paySC.getPayTo(), owner, "payTo should be correct on paymentSC")
    assert.equal(await paySC.getPayTo(), owner, "payTo should be correct on ix")
    assert.equal(await paySC.owner(), owner, "owner on paymentSC")
    assert.equal(await svIx.owner(), owner, "owner on svIx")

    await doLog('checked payto and owner')

    assert.equal(await be.getGDemocsN(), 0, 'no democs yet')
    // assert.equal(await be.getGDemoc(0), zeroHash, 'democ 0 has zero hash')

    await doLog('checked getGDemocs')

    assert.deepEqual(await be.getGErc20ToDemocs(erc20.address), [], 'empty list for erc20 lookup')

    await doLog('checked getGErc20ToDemocs')

    const {democHash, ixPx, adminPx} = await mkDemoc({svIx, erc20, txOpts: {from: owner, value: 100}})
    const {democHash: democHash2} = await mkDemoc({svIx, erc20, txOpts: {from: owner, value: 100}})

    await doLog('created 2x democs')

    assert.equal(await be.getGDemocsN(), 2, '2 democs now')
    assert.equal(await be.getGDemoc(0), democHash, 'democ 0 has expected hash')
    assert.equal(await be.getGDemoc(1), democHash2, 'democ 1 has expected hash')

    assert.deepEqual(await be.getGErc20ToDemocs(erc20.address), [democHash, democHash2], 'erc20 lookup gives us our democs')

    assert.deepEqual(await be.getDInfo(democHash), [erc20.address, adminPx.address, toBigNumber(0)], 'getDInfo works as expected (0)')
    await ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, await mkStdPacked())
    assert.deepEqual(await be.getDInfo(democHash), [erc20.address, adminPx.address, toBigNumber(1)], 'getDInfo works as expected (1)')
}


const testCreateDemoc = async ({accounts, svIx, erc20, tld, ensPR, scLog, owner, be}) => {
    const [user0, user1, user2] = accounts;

    const {democHash, adminPx} = await mkDemoc({svIx, erc20, txOpts: {from: user1, value: oneEth}})

    await scLog.log(`Created democ w hash ${democHash} and admin ${adminPx.address}`)

    // ensure domain created and matches for democ admin
    const democPrefixHex = democHash.slice(0, 13*2+2);
    const prefixB32 = hexToB32(democPrefixHex.slice(2));
    const expectedDomain = prefixB32 + '.' + tld;
    assert.equal(await ensPR.addr(nh.hash(expectedDomain)), adminPx.address, "adminPx addr resolves via ENS for democ")
    await scLog.log(`Created ENS->admin at ${expectedDomain}`)
    console.log("Sample domain created and tested at:", expectedDomain)

    // test some properties of adminPx
    assert.equal(await adminPx.admins(user1), true, "user1 should be admin to start with");
    await adminPx.addAdmin(user2, {from: user1});
    await adminPx.removeAdmin(user1, {from: user2});
    assert.equal(await adminPx.admins(user1), false, "user1 should no longer be admin");
    await adminPx.setOwnerAsAdmin({from: user1});
    assert.equal(await adminPx.admins(user1), true, "user1 should be admin again");

    // test ercOwnerClaim
    assert.equal(await adminPx.admins(owner), false, "erc20 owner not admin by default");
    await adminPx.ercOwnerClaim({from: owner});

    assert.equal(await adminPx.admins(owner), true, "erc20 owner claim works");
    await assertRevert(adminPx.ercOwnerClaim({from: accounts[2]}), "erc20 owner can't claim if now actual owner")

    await adminPx.removeAdmin(owner, {from: user1});
    await adminPx.setAllowErc20OwnerClaim(false, {from: user1});

    await assertRevert(adminPx.ercOwnerClaim({from: owner}), "erc20 owner can't claim if feature disabled")
}


const testPaymentsForDemoc = async ({accounts, svIx, erc20, paySC, owner, scLog, be}) => {
    // test that payments behave as expected

    // for simplicity we should set the exchange rate to something simple
    // this means 10^14 wei per 1c => 1 eth per $100
    await paySC.setWeiPerCent(toBigNumber(oneEth.div(10000)), {from: owner});
    await assertRevert(paySC.setWeiPerCent(1, {from: accounts[2]}), "can't set wei from non-admin account");
    await scLog.log("set exchange rate")

    await scLog.log(`${await paySC.weiBuysHowManySeconds(toBigNumber('1e13'))}`)
    await scLog.log(`${await paySC.weiBuysHowManySeconds(toBigNumber('1e18'))}`)

    const oneEthShouldBuy = await paySC.weiBuysHowManySeconds(toBigNumber(oneEth));
    // this should be 10% of 30 days
    assert.equal(oneEthShouldBuy.toNumber(), 3 * 24 * 60 * 60, "one eth should buy 3 days with testing params");
    await scLog.log("1 eth buys correct number of days");

    const user1 = accounts[1];

    // create the democ with an absurdly small fee -
    const {democHash, adminPx} = await mkDemoc({svIx, erc20, txOpts: {from: user1, value: 1}});
    assert.equal(await paySC.accountInGoodStanding(democHash), false, "democ should not be in good standing with such a small fee");
    await scLog.log("Created democ and ensured it's not in good standing");

    await paySC.payForDemocracy(democHash, {from: user1, value: oneEth});
    assert.equal(await paySC.accountInGoodStanding(democHash), true, "democ should now be in good standing");

    const secRemaining = await paySC.getSecondsRemaining(democHash);
    assert.equal(oneEthShouldBuy - secRemaining < 10, true, "should have correct time remaining to within 10s")

    // some random sending $ for democ
    await adminPx.sendTransaction({from: accounts[2], value: oneEth});

    const secRemaining2 = await paySC.getSecondsRemaining(democHash);
    assert.equal(2 * oneEthShouldBuy - secRemaining2 < 10, true, "should have correct time remaining (again) to within 10s")

    // check payments work via owner balance
    const balPre = await getBalance(owner);
    await paySC.sendTransaction({from: accounts[2], value: oneEth});
    assert.deepEqual(balPre.plus(toBigNumber(oneEth)), await getBalance(owner), `paySC fallback works (pre-balance: ${balPre.toString()}`);

    // any more tests?
}


const testCommunityBallots = async ({accounts, owner, svIx, erc20, doLog, paySC, be}) => {
    // test in cases we have a community instance and in cases where
    // they're enabled on a paying democ

    await doLog('start of testCommunityBallots')

    const {args: {democHash, admin}} = getEventFromTxR("DemocAdminSet", await svIx.dInit(erc20.address, {value: 1}))
    const adminPx = SVAdminPx.at(admin);
    const ixPx = SVIndex.at(admin);

    await doLog('prepped community ballots test')

    assert.equal(await adminPx.getCommunityBallotsEnabled(), true, "comm ballots on by default")
    await doLog('verified comm ballots enabled')

    const [s,e] = await genStartEndTimes()
    const packed = mkPacked(s, e, USE_ETH | USE_NO_ENC)
    const packedTimes = toBigNumber(mkPackedTime(s, e));

    await doLog('getting cBallot price')
    const commBPrice = await paySC.getCommunityBallotWeiPrice()
    const commBPriceStr = web3.fromWei(commBPrice.toFixed(), 'ether')
    await doLog(`got cBallot price: ${commBPriceStr}`)

    const user = accounts[3];
    const balPre = await getBalance(user)
    // use extraData as random bytes here for coverage
    const dcbTxr = await adminPx.deployCommunityBallot(genRandomBytes32(), zeroHash, packedTimes, {value: commBPrice.plus(web3.toWei(1, "ether")), gasPrice: 0, from: user})
    const balPost = await getBalance(user)
    await doLog(`deployed community ballot!`)

    const balPreStr = web3.fromWei(balPre, 'ether')
    const balPostStr = web3.fromWei(balPost, 'ether')
    await doLog(`\nCBallot: ${commBPriceStr}\nBalPre : ${balPreStr}\nBalPost: ${balPostStr}\n`)
    assert.deepEqual(balPre.minus(commBPrice), balPost, "balances should match after community ballot fee (includes refund)")

    await adminPx.setCommunityBallotStatus(false);
    await doLog('set community ballot to false')

    // this should still work because the democ is not in good standing
    await adminPx.deployCommunityBallot(genRandomBytes32(), zeroHash, packedTimes, {value: commBPrice.plus(web3.toWei(1, "ether")), gasPrice: 0, from: user})
    await assertRevert(
        adminPx.deployCommunityBallot(genRandomBytes32(), zeroHash, packedTimes, {value: commBPrice.minus(1), gasPrice: 0, from: user}),
        "should not allow a community ballot with fee below the right amount"
    )

    assert.equal(await paySC.accountInGoodStanding(democHash), false, "account should not be in good standing")
    await doLog('confirmed democ is not in good standing')

    // after this tx the account should be in good standing and this should fail
    await adminPx.sendTransaction({from: user, value: web3.toWei(1, 'ether')})
    await doLog('sent funding tx for democ')

    assert.equal(await paySC.accountInGoodStanding(democHash), true, "account should now be in good standing")
    await doLog('paid 1 ether to democ & confirmed in good standing')

    await assertRevert(
        adminPx.deployCommunityBallot(genRandomBytes32(), zeroHash, packedTimes, {value: commBPrice.plus(web3.toWei(1, "ether")), gasPrice: 0, from: user}),
        "should revert because the democ is now in good standing"
    );

    const secsRemaining = (await paySC.getSecondsRemaining(democHash)).toNumber()
    await increaseTime(secsRemaining + 10)
    // send a tx so we make sure the last block has the new timestamps
    await sendTransaction({to: accounts[1], from: accounts[0], value: 1})
    const b = await getBlock('latest')
    const packedTimes2 = await genPackedTime()

    assert.equal(await paySC.accountInGoodStanding(democHash), false, "time now expired")
    // commb works again
    await adminPx.deployCommunityBallot(genRandomBytes32(), zeroHash, packedTimes2, {value: commBPrice})

    // set up to test counting of ballots when it does qualify as a community ballot but
    // community ballots are disabled (and democ in good standing)
    const count1 = await be.getDCountedBasicBallotsN(democHash);
    await adminPx.setCommunityBallotStatus(true);
    await paySC.payForDemocracy(democHash, {value: oneEth})  // now in good standing
    await doLog('paid for democ in prep of checking commb count')

    const [s2, e2] = await genStartEndTimes()
    // this qualifies as a community ballot, but because commballots are enabled it should not increase count
    await ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkPacked(s2, e2, USE_ETH | USE_NO_ENC))
    await doLog('deployed normal ballot')

    const count2 = await be.getDCountedBasicBallotsN(democHash);
    assert.deepEqual(count1, count2, 'ballot deploy did not increase count')
    await doLog('verified ballot did not increase count')

    // prepped
    await adminPx.setCommunityBallotStatus(false);
    await doLog('set commballots disabled')
    await ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkPacked(s2, e2, USE_ETH | USE_NO_ENC))
    // now that commballots are disabled, this should increase the count
    const count3 = await be.getDCountedBasicBallotsN(democHash)
    assert.deepEqual(count3.minus(1), count2, 'should have incremented count by 1')
}


const testCurrencyConversion = async ({svIx, paySC, owner, accounts, doLog, be}) => {
    // test our payment code around eth/usd stuff

    const [,minorEdits,u2,u3,u4,u5] = accounts;

    const testWeiAndPrices = async () => {
        const weiPerCent = await paySC.getWeiPerCent();
        assert.deepEqual(await paySC.weiBuysHowManySeconds(weiPerCent.times(100000)), toBigNumber(60 * 60 * 24 * 30), '100k x weiPerCent should buy 30 days')
        assert.deepEqual(await paySC.weiBuysHowManySeconds(weiPerCent.times(50000)), toBigNumber(60 * 60 * 24 * 15), '50k x weiPerCent should buy 15 days')
        assert.deepEqual(await paySC.weiBuysHowManySeconds(weiPerCent.times(200000)), toBigNumber(60 * 60 * 24 * 60), '200k x weiPerCent should buy 60 days')

        assert.deepEqual(await paySC.getCommunityBallotWeiPrice(), weiPerCent.times(1000), 'community ballot should cost ~$10')
        assert.deepEqual(await paySC.getBasicCentsPricePer30Days(), toBigNumber(100000), 'basic costs $1000/mo or $100k cents / mo')

        const basicBallotsPerMonth = await paySC.getBasicBallotsPer30Days()
        assert.deepEqual(basicBallotsPerMonth, toBigNumber(5), 'basic ballots per month is 5 at start')
        assert.deepEqual(await paySC.getBasicExtraBallotFeeWei(), weiPerCent.times(100000).div(basicBallotsPerMonth), 'extra ballot should cost approx 1/nth of basic price where n is how many ballots pe rmonth they get')
    }

    assert.deepEqual(await paySC.getCommunityBallotCentsPrice(), toBigNumber(1000), "community cents price should be $10 init")

    // test setExchAddr
    // test set exchange rate
    // test expected for certain exchange rates
    // test under different exchange rates

    const weiPerCent1 = await paySC.getWeiPerCent();
    assert.deepEqual(weiPerCent1, toBigNumber('18975332000000'), 'wei per cent matches init expectations')
    assert.deepEqual(await paySC.getUsdEthExchangeRate(), toBigNumber(52700), 'usd/eth init matches expected')
    assert.deepEqual(await paySC.weiToCents(weiPerCent1), toBigNumber(1), '1 cent sanity check init')

    await testWeiAndPrices();

    await doLog('set exchange rate to $666usd/eth')
    await paySC.setWeiPerCent(toBigNumber('15015015000000'))
    const weiPerCent2 = await paySC.getWeiPerCent();
    assert.deepEqual(weiPerCent2, toBigNumber('15015015000000'), 'wei per cent matches init expectations')
    assert.deepEqual(await paySC.getUsdEthExchangeRate(), toBigNumber(66600), 'usd/eth init matches expected')
    assert.deepEqual(await paySC.weiToCents(weiPerCent2), toBigNumber(1), '1 cent sanity check 2')

    await testWeiAndPrices();

    await paySC.setMinorEditsAddr(minorEdits);

    await doLog('set exchange rate to $9001usd/eth')
    await paySC.setWeiPerCent(toBigNumber('1110987600000'), {from: minorEdits})
    const weiPerCent3 = await paySC.getWeiPerCent();
    assert.deepEqual(weiPerCent3, toBigNumber('1110987600000'), 'wei per cent matches init expectations')
    assert.deepEqual(await paySC.getUsdEthExchangeRate(), toBigNumber(900100), 'usd/eth init matches expected')
    assert.deepEqual(await paySC.weiToCents(weiPerCent3), toBigNumber(1), '1 cent sanity check 3')
    assert.deepEqual(await paySC.weiToCents(weiPerCent3.times(2)), toBigNumber(2), '2 cent sanity check @ 3')
    assert.deepEqual(await paySC.weiToCents(weiPerCent3.times(1.7)), toBigNumber(1), '1 cent rounding check')

    await testWeiAndPrices();

    await assertRevert(paySC.setWeiPerCent(toBigNumber('111'), {from: u3}), 'cannot set exchange rate from bad acct')
}


const testPaymentsEmergencySetOwner = async ({paySC, owner, backupOwner, accounts, be}) => {
    const [,u1,u2,u3,u4,badActor] = accounts;
    assert.equal(await paySC.emergencyAdmin(), backupOwner, 'emergencyAdmin on paySC init good')
    assert.equal(await paySC.owner(), owner, 'payments owner init good')

    await assertRevert(paySC.emergencySetOwner(badActor, {from: badActor}), 'cannot emergency set owner from bad acct')

    await assertRevert(paySC.emergencySetOwner(u1, {from: owner}), 'owner cannot emergency set owner')
    await paySC.emergencySetOwner(u1, {from: backupOwner})
    assert.equal(await paySC.owner(), u1, 'payment owner changed')
}


const testAllAdminFunctionsAndCategories = async ({owner, accounts, svIx, erc20, doLog, paySC, be}) => {
    const [, u1, u2, u3, u4, u5, badActor, token1] = accounts;
    const {democHash, adminPx, ixPx} = await mkDemoc({svIx, erc20, txOpts: {value: 1}})

    const testOnlyAdmin = async (m, args) => {
        await assertRevert(ixPx[m](...args, {from: badActor}), `ixPx.${m}(${args}, {from: badActor}) fails`)
        await assertRevert(svIx[m](...args, {from: badActor}), `svIx.${m}(${args}, {from: badActor}) fails`)
        await ixPx[m](...args, {from: owner})
    }

    const testOnlyAdminPayments = async (m, args) => {
        await assertRevert(paySC[m](...args, {from: badActor}), `payments.${m}(${args}, {from: badActor}) fails`)
        await paySC[m](...args, {from: owner})
    }

    const testOnlyAdminBackend = async (m, args) => {
        await assertRevert(be[m](...args, {from: badActor}), `backend.${m}(${args}, {from: badActor}) fails`)
        await be[m](...args, {from: owner})
    }

    // set erc20
    assert.deepEqual(await be.getGErc20ToDemocs(erc20.address), [democHash], 'democHash in erc20 lookup init')
    assert.deepEqual(await be.getGErc20ToDemocs(token1), [], 'token1 lookup init []')
    await testOnlyAdmin('setDErc20', [democHash, token1])
    assert.deepEqual(await be.getGErc20ToDemocs(erc20.address), [democHash], 'democHash in erc20 lookup')
    assert.deepEqual(await be.getGErc20ToDemocs(token1), [democHash], 'democHash in token1 lookup')

    // add category
    assert.equal(await be.getDCategoriesN(democHash), 0, 'no cats to start with')
    await testOnlyAdmin('dAddCategory', [democHash, "cat1", false, 0])
    await testOnlyAdmin('dAddCategory', [democHash, "cat2", true, 0])
    await testOnlyAdmin('dAddCategory', [democHash, "cat3", true, 1])
    assert.equal(await be.getDCategoriesN(democHash), 3, 'cats created')
    assert.deepEqual(await be.getDCategory(democHash, 0), [false, "0x6361743100000000000000000000000000000000000000000000000000000000", false, toBigNumber(0)], 'cat0 created')
    assert.deepEqual(await be.getDCategory(democHash, 1), [false, "0x6361743200000000000000000000000000000000000000000000000000000000", true, toBigNumber(0)], 'cat1 created')
    assert.deepEqual(await be.getDCategory(democHash, 2), [false, "0x6361743300000000000000000000000000000000000000000000000000000000", true, toBigNumber(1)], 'cat2 created')
    // test they worked

    // deprecate cat - note, deprecation is not recursive
    await testOnlyAdmin('dDeprecateCategory', [democHash, 1])
    assert.deepEqual(await be.getDCategory(democHash, 0), [false, "0x6361743100000000000000000000000000000000000000000000000000000000", false, toBigNumber(0)], 'cat0 matches')
    assert.deepEqual(await be.getDCategory(democHash, 1), [true, "0x6361743200000000000000000000000000000000000000000000000000000000", true, toBigNumber(0)], 'cat1 deprecated')
    assert.deepEqual(await be.getDCategory(democHash, 2), [false, "0x6361743300000000000000000000000000000000000000000000000000000000", true, toBigNumber(1)], 'cat2 matches')

    // upgrade
    assert.equal(await paySC.accountInGoodStanding(democHash), false, 'democ not in good standing yet')
    await paySC.payForDemocracy(democHash, {from: u3, value: oneEth});
    assert.equal(await paySC.accountInGoodStanding(democHash), true, 'democ now in good standing')
    assert.equal(await paySC.getPremiumStatus(democHash), false, 'democ not premium and in good standing')
    await testOnlyAdmin('dUpgradeToPremium', [democHash])
    assert.equal(await paySC.accountInGoodStanding(democHash), true, 'democ now in good standing')
    assert.equal(await paySC.getPremiumStatus(democHash), true, 'democ now IS premium and in good standing')

    // downgrade
    await increaseTime(60 * 60 * 24 + 10)  // allow downgrade to work
    await testOnlyAdmin('dDowngradeToBasic', [democHash])
    assert.equal(await paySC.accountInGoodStanding(democHash), true, 'democ still in good standing')
    assert.equal(await paySC.getPremiumStatus(democHash), false, 'democ no longer premium and in good standing')


    // deploy
    assert.equal(await be.getDBallotsN(democHash), 0, '0 ballots')
    await testOnlyAdmin('dDeployBallot', [democHash, genRandomBytes32(), zeroHash, await mkStdPacked()])
    assert.equal(await be.getDBallotsN(democHash), 1, '1 ballot')

    // payments
    await Promise.all(R.map(testArgs => testOnlyAdminPayments(...testArgs),
        [ [ 'giveTimeToDemoc', [zeroHash, 1000, "0x00"] ]
        , [ 'setPayTo', [owner] ]
        , [ 'setCommunityBallotCentsPrice', [toBigNumber(999)] ]
        , [ 'setBasicCentsPricePer30Days', [toBigNumber(999)] ]
        , [ 'setBasicBallotsPer30Days', [toBigNumber(999)] ]
        , [ 'setPremiumMultiplier', [toBigNumber(25)] ]
        , [ 'setWeiPerCent', [toBigNumber(999)] ]
        , [ 'setMinorEditsAddr', [zeroAddr] ]
        , [ 'setDenyPremium', [zeroHash, true] ]
        ]));

    // backend
    await Promise.all(R.map(testArgs => testOnlyAdminBackend(...testArgs),
        [ [ 'dAdd', [zeroHash, zeroAddr] ]
        ]))
}


const testPrefix = async ({svIx, owner, doLog, ensPR, tld, erc20, be}) => {
    const {democHash, adminPx, ixPx} = await mkDemoc({svIx, erc20, txOpts: {from: owner, value: 1}})

    const prefixHex = democHash.slice(2, 2 + 26)
    const prefixBase32 = hexToB32(prefixHex)

    assert.equal(await be.getDHash("0x" + prefixHex), democHash)

    const prefixNode = nh.hash(prefixBase32 + "." + tld)

    assert.equal(await ensPR.addr(prefixNode), adminPx.address, "prefix.tld lookup for admin SC works")
}


const testRevertCases = async ({svIx, owner, doLog, erc20, paySC, be}) => {
    await assertRevert(IxPayments.new(zeroAddr), "payments throws on zeroAddr")

    const {democHash, adminPx, ixPx} = await mkDemoc({svIx, erc20, txOpts: {value: 1}})

    await assertRevert(paySC.payForDemocracy(democHash, {value: 0}), 'zero payment should revert')
    await paySC.payForDemocracy(democHash, {value: oneEth})

    const [s,e] = await genStartEndTimes()
    await assertRevert(ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkPacked(s, e, USE_ETH | USE_NO_ENC | USE_TESTING)), 'should revert as testing ballots cant be deployed through index')
    await ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash,              mkPacked(s, e, USE_ETH | USE_NO_ENC))

    await be.dAdd(toHex("test democ"), erc20.address)
    await asyncAssertThrow(() => be.dAdd(toHex("test democ"), erc20.address), 'conflict of democHash prefix')
}


const testPremiumUpgradeDowngrade = async ({svIx, owner, doLog, erc20, paySC, be}) => {
    const premMultiplier = (await paySC.getPremiumMultiplier()).toNumber()
    const premPrice30Days = await paySC.getPremiumCentsPricePer30Days()
    const premWeiPer30Days = await paySC.centsToWei(premPrice30Days)
    const weiPerCent = await paySC.getWeiPerCent();
    const {democHash, adminPx, ixPx} = await mkDemoc({svIx, erc20, txOpts: {value: 1}})
    const b = await getBlock('latest')

    // test upgrade and downgrade with no time
    assert.deepEqual(await paySC.getAccount(democHash), [false, toBigNumber(0), toBigNumber(0)], 'getAccount matches init expectations')
    assert.equal(await paySC.getPremiumStatus(democHash), false, 'not premium 1')
    await ixPx.dUpgradeToPremium(democHash)
    assert.deepEqual(await paySC.getAccount(democHash), [true, toBigNumber(0), toBigNumber(0)], 'getAccount matches expectations after null upgrade')
    assert.equal(await paySC.getPremiumStatus(democHash), true, 'is premium 1')
    // we can downgrade freely if there are 0 seconds left
    await ixPx.dDowngradeToBasic(democHash)
    assert.deepEqual(await paySC.getAccount(democHash), [false, toBigNumber(0), toBigNumber(0)], 'getAccount matches expectations after null downgrade')
    assert.equal(await paySC.getPremiumStatus(democHash), false, 'not premium 2')

    assert.deepEqual(await paySC.getSecondsRemaining(democHash), toBigNumber(0), 'no seconds remaining')

    // now with payments
    const centsFor30Days = await paySC.getBasicCentsPricePer30Days();
    const weiFor30Days = await paySC.centsToWei(centsFor30Days);
    assert.deepEqual(await paySC.weiToCents(weiFor30Days), toBigNumber(100000), '30 days of wei matches cents expectation')
    await paySC.payForDemocracy(democHash, {value: weiFor30Days})
    const b2 = await getBlock('latest')
    assert.deepEqual(await paySC.getAccount(democHash), [false, toBigNumber(b2.timestamp), toBigNumber(b2.timestamp + 60 * 60 * 24 * 30)], 'getAccount matches after payment')
    assert.reallyClose(await paySC.getSecondsRemaining(democHash), toBigNumber(60 * 60 * 24 * 30), 'should have 30 days left')

    // let's do that upgrade!
    await ixPx.dUpgradeToPremium(democHash)
    await assertRevert(ixPx.dUpgradeToPremium(democHash), 'cannot upgrade to premium twice')
    assert.deepEqual(await paySC.getAccount(democHash), [true, toBigNumber(b2.timestamp), toBigNumber(b2.timestamp + 60 * 60 * 24 * 30 / premMultiplier)], 'getAccount matches after upgrade')
    assert.reallyClose(await paySC.getSecondsRemaining(democHash), toBigNumber(60 * 60 * 24 * 30 / premMultiplier), 'should have 6 days left')

    await paySC.payForDemocracy(democHash, {value: weiFor30Days})
    const b3 = await getBlock('latest')
    assert.deepEqual(await paySC.getAccount(democHash), [true, toBigNumber(b3.timestamp), toBigNumber(b2.timestamp + 2 * 60 * 60 * 24 * 30 / premMultiplier)], 'getAccount matches after upgrade')
    assert.reallyClose(await paySC.getSecondsRemaining(democHash), toBigNumber(2 * 60 * 60 * 24 * 30 / premMultiplier), 'should have 12 days left')

    assert.deepEqual(premPrice30Days, centsFor30Days.times(premMultiplier), 'prices match according to premium multiplier')

    await paySC.payForDemocracy(democHash, {value: premWeiPer30Days})
    const b4 = await getBlock('latest')
    let timeLeft = ((2 + premMultiplier) * 60 * 60 * 24 * 30 / premMultiplier);
    assert.deepEqual(await paySC.getAccount(democHash), [true, toBigNumber(b4.timestamp), toBigNumber(b2.timestamp + timeLeft)], 'getAccount matches after upgrade')
    assert.reallyClose(await paySC.getSecondsRemaining(democHash), toBigNumber(timeLeft), 'should have 42 days left')


    // and test downgrades
    await assertRevert(ixPx.dDowngradeToBasic(democHash), 'should error on downgrade <24hrs after upgrade')
    const timeOffset = 60 * 60 * 24 + 10
    await increaseTime(timeOffset)  // move forward so we can downgrade
    timeLeft -= timeOffset
    await ixPx.dDowngradeToBasic(democHash)
    timeLeft *= premMultiplier
    await assertRevert(ixPx.dDowngradeToBasic(democHash), 'cant downgrade twice')
    const b5 = await getBlock('latest')

    // need to split this up b/c the downgrade can have an error of up to 5s due to rounding (which occurs in the _upgrade_ step)
    const [isPrem, lastPaid, paidTill] = await paySC.getAccount(democHash);
    assert.deepEqual([isPrem, lastPaid], [false, toBigNumber(b4.timestamp)], 'getAccount [0:1] matches after downgrade')
    assert.reallyClose(paidTill, toBigNumber(b5.timestamp + timeLeft), 'getAccount paidTill matches after downgrade', 6)
    assert.reallyClose(await paySC.getSecondsRemaining(democHash), toBigNumber(timeLeft), 'should have 42*5 days left', 6)

    // check payments log
    assert.deepEqual(await paySC.getPaymentLogN(), toBigNumber(4), 'payment n log as expected')
    assert.deepEqual(await paySC.getPaymentLog(0), [false, democHash, toBigNumber(0), toBigNumber(1)], 'payment 0 matches')
    assert.deepEqual(await paySC.getPaymentLog(1), [false, democHash, toBigNumber(60*60*24*30), weiFor30Days], 'payment 1 matches')
    assert.deepEqual(await paySC.getPaymentLog(2), [false, democHash, toBigNumber(60*60*24*30 / premMultiplier | 0), weiFor30Days], 'payment 2 matches')
    assert.deepEqual(await paySC.getPaymentLog(3), [false, democHash, toBigNumber(60*60*24*30), premWeiPer30Days], 'payment 3 matches')


    await paySC.giveTimeToDemoc(democHash, 100, "a reference")
    assert.deepEqual(await paySC.getPaymentLog(4), [true, democHash, toBigNumber(100), toBigNumber(0)], 'payment 3 matches')
}


const testPaymentsSettingValues = async ({svIx, owner, doLog, erc20, paySC, be}) => {
    const initWeiPerCent = toBigNumber('18975332000000')
    const initCommBPrice = toBigNumber(1000)
    const initCentsPer30Days = toBigNumber(100000)
    const initBallotsPerMonth = toBigNumber(5)
    const initPremMult = toBigNumber(5)
    const initExchRate = toBigNumber(52700)
    const initCommBWeiPrice = initWeiPerCent.times(initCommBPrice)
    const initExtraBallotWei = initCentsPer30Days.div(initBallotsPerMonth).times(initWeiPerCent)

    // test initial values
    assert.deepEqual(await paySC.getCommunityBallotCentsPrice(), initCommBPrice, 'commb opening price')
    assert.deepEqual(await paySC.getCommunityBallotWeiPrice(), initCommBWeiPrice, 'commb init wei price')
    assert.deepEqual(await paySC.getBasicCentsPricePer30Days(), initCentsPer30Days, 'basic 30 days cents price')
    assert.deepEqual(await paySC.getBasicExtraBallotFeeWei(), initExtraBallotWei, 'init extra ballot wei')
    assert.deepEqual(await paySC.getBasicBallotsPer30Days(), initBallotsPerMonth, 'init ballots / mo')
    assert.deepEqual(await paySC.getPremiumMultiplier(), initPremMult, 'init prem mult')
    assert.deepEqual(await paySC.getPremiumCentsPricePer30Days(), initCentsPer30Days.times(initPremMult), 'init prem cents / mo')
    assert.deepEqual(await paySC.getWeiPerCent(), initWeiPerCent, 'init wei per cent')
    assert.deepEqual(await paySC.getUsdEthExchangeRate(), initExchRate, 'init cents/eth')


    const newWeiPerCent = toBigNumber('58976170000000')
    const newExchRate = toBigNumber('16956')
    const newCommBPrice = toBigNumber('5000')
    const newCommBWei = newWeiPerCent.times(newCommBPrice)
    const newCentsPer30Days = toBigNumber('150000')
    const newBallotsPerMonth = toBigNumber('10')
    const newExtraBWei = newCentsPer30Days.div(newBallotsPerMonth).times(newWeiPerCent)
    const newPremMult = toBigNumber('3')
    const newPremCents = newCentsPer30Days.times(newPremMult)

    await paySC.setWeiPerCent(newWeiPerCent)
    await paySC.setCommunityBallotCentsPrice(newCommBPrice)
    await paySC.setBasicCentsPricePer30Days(newCentsPer30Days)
    await paySC.setBasicBallotsPer30Days(newBallotsPerMonth)
    await paySC.setPremiumMultiplier(newPremMult)

    assert.deepEqual(await paySC.getCommunityBallotCentsPrice(), newCommBPrice, 'commb new price')
    assert.deepEqual(await paySC.getCommunityBallotWeiPrice(), newCommBWei, 'commb new wei price')
    assert.deepEqual(await paySC.getBasicCentsPricePer30Days(), newCentsPer30Days, 'new basic 30 days cents price')
    assert.deepEqual(await paySC.getBasicExtraBallotFeeWei(), newExtraBWei, 'new extra ballot wei')
    assert.deepEqual(await paySC.getBasicBallotsPer30Days(), newBallotsPerMonth, 'new ballots / mo')
    assert.deepEqual(await paySC.getPremiumMultiplier(), newPremMult, 'new prem mult')
    assert.deepEqual(await paySC.getPremiumCentsPricePer30Days(), newPremCents, 'new prem cents / mo')
    assert.deepEqual(await paySC.getWeiPerCent(), newWeiPerCent, 'new wei per cent')
    assert.deepEqual(await paySC.getUsdEthExchangeRate(), newExchRate, 'new cents/eth')
}


const testPaymentsPayoutAll = async ({svIx, paySC, owner, doLog, accounts, be}) => {
    const [, newPayTo, u2, u3, u4] = accounts;

    await paySC.setPayTo(newPayTo, {from: owner})

    const th = await TestHelper.new();

    await th.sendTransaction({value: oneEth, from: u4})

    const balPre = await getBalance(newPayTo);
    assert.deepEqual(await getBalance(th.address), oneEth, 'balance of test helper should be 1 ether')
    assert.equal(await getBalance(paySC.address), 0, 'paySC has no balance yet')
    await th.destroy(paySC.address)
    assert.deepEqual(await getBalance(paySC.address), oneEth, 'paySC should have 1 eth')
    await paySC.payoutAll()
    assert.equal(await getBalance(paySC.address), 0, 'paySC has sent balance away')
    assert.deepEqual(await getBalance(newPayTo), balPre.plus(oneEth), 'u1 now has one extra ether due to payoutAll')
}


const testSponsorshipOfCommunityBallots = async ({svIx, erc20, accounts, owner, bbFarm, doLog, paySC, be}) => {
    const [, dAdmin, u2, u3, u4, u5] = accounts

    await doLog('creating democ')
    const {democHash, adminPx, ixPx} = await mkDemoc({svIx, erc20, txOpts: {from: dAdmin, value: 1}})
    const times = await genPackedTime();

    await doLog('getting commb price and verifiying ballotsN === 0')
    const commBPriceEth = await paySC.getCommunityBallotWeiPrice();

    assert.equal(await be.getDBallotsN(democHash), 0, 'no ballots yet')

    await doLog('deploying commb')
    const commBTxr = await adminPx.deployCommunityBallot(genRandomBytes32(), zeroHash, times, {from: u2, value: commBPriceEth})
    const {args: {ballotId}} = getEventFromTxR("BallotCreatedWithID", commBTxr)
    await doLog(`got commb deployed with ballotId: ${ballotId} (txr: \n${toJson(commBTxr)})`)

    assert.equal(await be.getDBallotsN(democHash), 1, 'one ballot so far')

    const ballotIdCmp = await be.getDBallotID(democHash, 0);
    assert.deepEqual(ballotId, ballotIdCmp, 'ballotIds match')
    assert.equal(await bbFarm.getTotalSponsorship(ballotId), 0, 'no sponsorship yet')

    await doLog("sponsoring...")
    await bbFarm.sponsor(ballotId, {from: u3, value: 1001337})
    await bbFarm.sponsor(ballotId, {from: u4, value:  990000})
    await doLog('sponsored')

    assert.deepEqual(await bbFarm.getTotalSponsorship(ballotId), toBigNumber(1991337), 'sponsorship amount matches')
    assert.equal(await bbFarm.getSponsorsN(ballotId), 2, 'should have 2 sponsorships so far')

    assert.deepEqual(await bbFarm.getSponsor(ballotId, 0), [u3, toBigNumber(1001337)], 'sponsor 0 matches')
    assert.deepEqual(await bbFarm.getSponsor(ballotId, 1), [u4, toBigNumber(990000)], 'sponsor 1 matches')
}


const testVersion = async ({svIx}) => {
    assert.equal(2, await svIx.getVersion(), "expect version to be 2");
}


const testNFPTierAndPayments = async ({svIx, erc20, owner, accounts, doLog, paySC, be}) => {
    // test that we can give and remove time on NFP accounts

    const [, democAdmin, u2, u3, u4, u5] = accounts;

    const {democHash, adminPx, ixPx} = await mkDemoc({svIx, erc20, txOpts: {value: 1, from: democAdmin}})

    assert.equal(await paySC.getDenyPremium(democHash), false, 'should not have denyPremium yet')

    await paySC.setDenyPremium(democHash, true, {from: owner})
    assert.equal(await paySC.getDenyPremium(democHash), true, 'should have denyPremium now')

    await assertRevert(paySC.setDenyPremium(democHash, false, {from: democAdmin}), 'bad acct cant do setDenyPremium')
    await assertRevert(paySC.giveTimeToDemoc(democHash, 100, zeroHash, {from: democAdmin}), 'bad acct cant do giveTimeToDemoc')

    await paySC.giveTimeToDemoc(democHash, 60 * 60 * 24 * 30 * 2, toHex("nfp - test 1....."))

    await assertRevert(paySC.giveTimeToDemoc(democHash, 100, zeroHash, {from: u5}), 'u5 cant yet do giveTimeToDemoc')
    await paySC.setMinorEditsAddr(u5);
    await paySC.giveTimeToDemoc(democHash, 100, toHex("nfp - test 2....."), {from: u5})

    await assertRevert(ixPx.dUpgradeToPremium(democHash, {from: democAdmin}), "can't upgrade to premium because we've set denyPremium=true")
}


const testBasicExtraBallots = async ({svIx, owner, doLog, erc20, paySC, accounts, be, bbFarm}) => {
    const [, u1, u2, u3, u4] = accounts;

    const {democHash, adminPx, ixPx} = await mkDemoc({svIx, erc20, txOpts: {from: owner, value: oneEth.times(5)}})

    let _aBallotsCountedCalledN = 0;
    const assertBallotsCounted = async (n) => {
        _aBallotsCountedCalledN++;
        assert.equal((await be.getDCountedBasicBallotsN(democHash)).toNumber(), n, `ballots counted should be == ${n} (note: this is the ${_aBallotsCountedCalledN}th call to this assert)`)
    }
    await assertBallotsCounted(0)

    const nBallotsPerMonth = (await paySC.getBasicBallotsPer30Days()).toNumber()
    const extraBallotPrice = await paySC.getBasicExtraBallotFeeWei()

    const mkBallot = async (txOpts) => {
        const [s, e] = await genStartEndTimes()
        return await ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkPacked(s, e, USE_ETH | USE_ENC | IS_OFFICIAL | IS_BINDING), txOpts || {})
    }

    const {timestamp: firstBallotTs} = await getBlock('latest')
    // fill up our monthly quota
    for (let i = 0; i < nBallotsPerMonth; i++) {
        await assertBallotsCounted(i)
        await mkBallot()
    }
    await assertBallotsCounted(nBallotsPerMonth)

    // test this before anything else to make sure we're really limited
    await assertRevert(mkBallot(), `should not be able to make more than ${nBallotsPerMonth} official ballots per month for free`)

    await ixPx.dUpgradeToPremium(democHash)
    // can now add another ballot because we're premium
    await mkBallot()
    await assertBallotsCounted(nBallotsPerMonth)
    await increaseTime(60 * 60 * 24 + 10)  // move forward a bit more than a day
    await ixPx.dDowngradeToBasic(democHash)

    const {timestamp: s} = await getBlock('latest')
    const e = s + 600

    await assertRevert(mkBallot(), `still can't make more than ${nBallotsPerMonth} official ballots per month for free`)
    await assertRevert(ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkPacked(s, e, USE_ETH | USE_ENC)), 'b w enc')
    await assertRevert(ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkPacked(s, e, USE_ETH | USE_NO_ENC | IS_OFFICIAL)), 'b w official')
    await assertRevert(ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkPacked(s, e, USE_ETH | USE_NO_ENC | IS_BINDING)), 'b w binding')
    // this is okay as it qualifies as a community ballot
    await ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkPacked(s, e, USE_ETH | USE_NO_ENC))
    await assertBallotsCounted(nBallotsPerMonth)

    await assertRevert(mkBallot({value: extraBallotPrice.minus(1)}), 'required to pay >= fee')
    // this works though

    // need to do this to make sure we're not sending the money back to ourselves
    // derp
    await paySC.setPayTo(u4);

    const bal1 = await getBalance(owner)
    const payExtra = 1001337
    const bTxR = await mkBallot({value: extraBallotPrice.plus(payExtra), gasPrice: 0})
    const bal2 = await getBalance(owner)
    await doLog(`Balances around paying for an extra ballot:
        Pre:  (${bal1.toFixed()})
        Post: (${bal2.toFixed()})
        Diff: (${bal1.minus(bal2).toFixed()})
        Cost: (${extraBallotPrice.toFixed()})
        Sent: (${extraBallotPrice.plus(payExtra).toFixed()})
        Extra: (${payExtra})
        mkBallot TxR: (${toJson({...bTxR, receipt: {...bTxR.receipt, logs: "omitted"}})})
        mkBallot Tx: (${toJson(await getTransaction(bTxR.tx))})
        `)
    assert.deepEqual(bal1.minus(extraBallotPrice), bal2, 'balances should match and include refund (i.e. payextra was returned)')

    await mkBallot({value: extraBallotPrice})
    await mkBallot({value: extraBallotPrice})
    await assertBallotsCounted(nBallotsPerMonth)
    await assertRevert(mkBallot(), `still can't make more than ${nBallotsPerMonth} official ballots per month for free`)

    // let's timewarp to end of month
    await increaseTime(60 * 60 * 24 * 29 - 1000)
    await assertRevert(mkBallot(), `ballot and end of month (but before click over) still fails`)
    await increaseTime(1000 + 60 * 60)
    // this should now work
    await sendTransaction({from: accounts[0], to: accounts[1], value: 1})
    const bEnd = await getBlock('latest')
    await doLog(`testing ballot that should be in the new month.
        Started  ${firstBallotTs}
        Now is   ${bEnd.timestamp}
        diff as month proportion: ${(bEnd.timestamp - firstBallotTs) / 30 / 24 / 60 / 60}`)
    const ballotsCounted = (await be.getDCountedBasicBallotsN(democHash)).toNumber()
    await doLog(`Counted ballots: ${ballotsCounted} (and nBallots: ${nBallotsPerMonth}`)
    const earlyBallotIdResp = await be.getDCountedBasicBallotID(democHash, ballotsCounted - nBallotsPerMonth)
    await doLog(`earlyBallotId Raw: ${toJson(earlyBallotIdResp)}`)
    const earlyBallotId = earlyBallotIdResp.toNumber()
    await doLog(`earlyBallotId: ${earlyBallotId}`)
    await doLog(`earlyBallotTs: ${await bbFarm.getCreationTs(earlyBallotId)}`)
    const secsLeft = (await paySC.getSecondsRemaining(democHash)).toNumber()
    await doLog(`seconds left on democ: ${secsLeft}`)

    await mkBallot()

    // also ensure that if we try to make a ballot with an end time too far in the future - it fails
    const [s2] = await genStartEndTimes()
    await assertRevert(ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkPacked(s2, s2 + (2 * secsLeft) + 100, USE_ETH | USE_NO_ENC | IS_BINDING)), 'cannot create ballot with end time > 2x the seconds remaining')
    await ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkPacked(s2, s2 + (2 * secsLeft) - 100, USE_ETH | USE_NO_ENC | IS_BINDING))
}


const testEmergencyMethods = async ({svIx, accounts, owner, bbFarm, erc20, doLog, be, paySC, pxF, ensPx, ixEnsPx}) => {
    const setTo = accounts[2];

    let hasSetEmergency = false;

    const testAddr = async (property, expectedAddr, ...args) =>
        assert.equal(await svIx[property](...args), expectedAddr, `Address for ${property} (${hasSetEmergency ? 'emergency' : 'init'}) should match expected ${expectedAddr}`)

    const testBadAddr = async (prop, arg1) =>
        await assertRevert(svIx[prop](arg1, accounts[4], {from: accounts[4]}), `cannot run ${prop} from non-owner account`)

    /* setDAdmin */

    await doLog(`testing emergencySetDAdmin`)
    // test emergency set for democ - need to do this BEFORE setting backend to bad addr...
    const democAdmin = accounts[1];
    const badActor = accounts[4];
    const {democHash, adminPx, ixPx} = await mkDemoc({svIx, erc20, txOpts: {from: democAdmin, value: 1}})
    await doLog(`democ created.`)

    assert.equal(await be.getDAdmin(democHash), adminPx.address, "d admin should match")

    await doLog(`running emergencySetDAdmin`)
    await svIx.emergencySetDAdmin(democHash, setTo)
    assert.equal(await be.getDAdmin(democHash), setTo, "d admin should match after emergency")

    await assertRevert(svIx.emergencySetDAdmin(democHash, badActor, {from: badActor}), 'cannot emergency set admin for democ from bad acct')

    /* Other emergency methods */

    await doLog(`done. about to test init conditions for emergency methods`)

    await testAddr('getBackend', be.address)
    await testAddr('getPayments', paySC.address)
    await testAddr('getBBFarm', bbFarm.address, 0)
    await testAddr('adminPxFactory', pxF.address)

    await doLog(`init conditions validated. testing emergency set methods`)

    await assertRevert(svIx.emergencySetABackend("nonexistent", setTo), 'emergencySetABackend should revert with nonexistent backend label')
    await svIx.emergencySetABackend("payments", setTo)
    await svIx.emergencySetABackend("backend", setTo)
    await svIx.emergencySetABackend("adminPxF", setTo)
    await svIx.emergencySetBBFarm(0, setTo)
    hasSetEmergency = true;

    await doLog(`emergency set methods tested. testing setting from bad addrs`)

    await testBadAddr('emergencySetABackend', "payments")
    await testBadAddr('emergencySetABackend', "backend")
    await testBadAddr('emergencySetABackend', "adminPxF")
    await testBadAddr('emergencySetBBFarm', 0)

    await doLog(`setting from bad addrs tested. validating results`)

    await testAddr('getBackend', setTo)
    await testAddr('getPayments', setTo)
    await testAddr('getBBFarm', setTo, 0)
    await testAddr('adminPxFactory', setTo)

    await doLog(`results validated.`)

    await doLog(`done`)
}


const testOwnerAddBallot  = async ({svIx, accounts, owner, erc20, doLog, be}) => {
    const [, dAdmin, u2, u3, u4] = accounts;

    const {democHash, adminPx, ixPx} = await mkDemoc({svIx, erc20, txOpts: {from: dAdmin, value: oneEth}})

    await assertRevert(ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroAddr, await mkStdPacked(), {from: owner}), 'svIx owner cant call dDeployBallot')
    // democ admin can deploy
    await ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroAddr, await mkStdPacked(), {from: dAdmin})

    await svIx.dAddBallot(democHash, 666, await mkStdPacked(), {from: owner})
    await assertRevert(svIx.dAddBallot(democHash, 666, await mkStdPacked(), {from: dAdmin}), 'democAdmin cant call dAddBallot')
}


const testIxLib = async ({svIx, accounts, owner, erc20, doLog, be, paySC}) => {
    throw Error('unimpl')
}


const testGrantingSelfTime = async ({svIx, accounts, owner, erc20, doLog, be, paySC}) => {
    const [, u1, u2, u3, u4] = accounts;
    const {democHash, adminPx, ixPx} = await mkDemoc({svIx, erc20, txOpts: {from: u2, value: 1}})

    await assertRevert(paySC.freeExtension(democHash), 'cannot grant self time yet')
    assert.deepEqual(await paySC.getSecondsRemaining(democHash), toBigNumber(0), 'no time atm')

    const sec1 = 60 * 60 * 24 * 20;
    await paySC.giveTimeToDemoc(democHash, sec1, "0x00")
    assert.reallyClose(await paySC.getSecondsRemaining(democHash), toBigNumber(sec1), `has ${sec1} seconds`)

    const days60 = 60 * 60 * 24 * 60;
    assert.equal(await paySC.getFreeExtension(democHash), false, 'no free ext yet')
    await paySC.setFreeExtension(democHash, true)
    assert.equal(await paySC.getFreeExtension(democHash), true, 'has free ext now')

    await paySC.doFreeExtension(democHash, {from: u2})
    assert.reallyClose(await paySC.getSecondsRemaining(democHash), toBigNumber(days60), `has 60 days secs now`)
}



/* bb farm won - by a lot
    Std:  1392871
    Lib:  1310372
    NoSC: 155579
    BBFarm: 274586
*/
const testGasOfBallots = async ({svIx, owner, erc20, be}) => {
    const {democHash, adminPx, ixPx} = await mkDemoc({svIx, txOpts: {from: owner, value: 1}, erc20});
    const packed = toBigNumber(await mkStdPacked());

    // deploy a ballot to start with to make sure anything needed to be set is set
    const b0 = await getBalance(owner)

    await ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, packed, {gasPrice: 1})

    const b1 = await getBalance(owner)

    await ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, packed, {gasPrice: 1})

    const b2 = await getBalance(owner)

    await adminPx.deployCommunityBallot(genRandomBytes32(), zeroHash, mkPackedTime(...(await genStartEndTimes())), {value: oneEth, gasPrice: 1})

    // since owner is the payTo we don't have a net transfer of money
    const b3 = await getBalance(owner)


    console.log(`Deploy Ballot Gas Costs:
    InitBB: ${b0.minus(b1).toFixed()}
    BBFarm: ${b1.minus(b2).toFixed()}
    CommB:  ${b2.minus(b3).toFixed()}
    `)
}


contract("SVLightIndex", function (accounts) {
    tests = [
        ["test IxLib", testIxLib],
        ["test payments setting values", testPaymentsSettingValues],
        ["test nfp tier", testNFPTierAndPayments],
        ["test owner add ballot", testOwnerAddBallot],
        ["test paying for extra ballots (basic)", testBasicExtraBallots],
        ["test revert cases", testRevertCases],
        ["test premium upgrade and downgrade", testPremiumUpgradeDowngrade],
        ["test payments payout all", testPaymentsPayoutAll],
        ["test democ prefix stuff", testPrefix],
        ["test all admin functions and categories (crud)", testAllAdminFunctionsAndCategories],
        ["test currency conversion", testCurrencyConversion],
        ["test payments backup admin", testPaymentsEmergencySetOwner],
        ["test sponsorship of community ballots", testSponsorshipOfCommunityBallots],
        ["test emergency methods", testEmergencyMethods],
        ["test community ballots (default)", testCommunityBallots],
        ["test version", testVersion],
        ["test upgrade", testUpgrade],
        ["test instantiation", testInit],
        ["test creating democ and permissions", testCreateDemoc],
        ["test payments for democ", testPaymentsForDemoc],
        ["test gas ballots", testGasOfBallots],
    ];
    S.map(([desc, f]) => it(desc, wrapTestIx({accounts}, f)), tests);
});
