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
    const {args: {democHash, admin: pxAddr}} = getEventFromTxR("DemocAdded", createTx);
    const adminPx = SVAdminPx.at(pxAddr);
    const ixPx = SVIndex.at(pxAddr);

    return {democHash, adminPx, ixPx};
}


/* ACTUAL TESTS */

const testUpgrade = async ({svIx, ensPx, paySC, be, ixEnsPx, pxF, bbFarm, owner, erc20}) => {
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
    const {args: {democHash, admin}} = getEventFromTxR("DemocAdded", await svIx.dInit(erc20.address, {from: owner, value: 1}))
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
    await ixPx.payForDemocracy(democHash, {value: 1})
    assert.equal(await adminPx._forwardTo(), newIx.address, "adminPx fwdTo upgrades automagically when sending after upgrade")
}


const testInit = async ({paySC, owner, svIx, erc20, doLog}) => {
    // just test the initialization params and sanity check

    assert.equal(await paySC.getPayTo(), owner, "payTo should be correct on paymentSC")
    assert.equal(await svIx.getPayTo(), owner, "payTo should be correct on ix")
    assert.equal(await paySC.owner(), owner, "owner on paymentSC")
    assert.equal(await svIx.owner(), owner, "owner on svIx")

    await doLog('checked payto and owner')

    assert.equal(await svIx.getGDemocsN(), 0, 'no democs yet')
    // assert.equal(await svIx.getGDemoc(0), zeroHash, 'democ 0 has zero hash')

    await doLog('checked getGDemocs')

    assert.deepEqual(await svIx.getGErc20ToDemocs(erc20.address), [], 'empty list for erc20 lookup')

    await doLog('checked getGErc20ToDemocs')

    const {democHash, ixPx, adminPx} = await mkDemoc({svIx, erc20, txOpts: {from: owner, value: 100}})
    const {democHash: democHash2} = await mkDemoc({svIx, erc20, txOpts: {from: owner, value: 100}})

    await doLog('created 2x democs')

    assert.equal(await svIx.getGDemocsN(), 2, '2 democs now')
    assert.equal(await svIx.getGDemoc(0), democHash, 'democ 0 has expected hash')
    assert.equal(await svIx.getGDemoc(1), democHash2, 'democ 1 has expected hash')

    assert.deepEqual(await svIx.getGErc20ToDemocs(erc20.address), [democHash, democHash2], 'erc20 lookup gives us our democs')

    assert.deepEqual(await svIx.getDInfo(democHash), [erc20.address, adminPx.address, toBigNumber(0)], 'getDInfo works as expected (0)')
    await ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkStdPacked())
    assert.deepEqual(await svIx.getDInfo(democHash), [erc20.address, adminPx.address, toBigNumber(1)], 'getDInfo works as expected (1)')
}


const testCreateDemoc = async ({accounts, svIx, erc20, tld, ensPR, scLog, owner}) => {
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


const testPaymentsForDemoc = async ({accounts, svIx, erc20, paySC, owner, scLog}) => {
    // test that payments behave as expected

    // for simplicity we should set the exchange rate to something simple
    // this means 10^14 wei per 1c => 1 eth per $100
    await paySC.setWeiPerCent(toBigNumber(oneEth.divn(10000)), {from: owner});
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
    assert.equal(await svIx.accountInGoodStanding(democHash), false, "democ should not be in good standing with such a small fee");
    await scLog.log("Created democ and ensured it's not in good standing");

    await paySC.payForDemocracy(democHash, {from: user1, value: oneEth});
    assert.equal(await svIx.accountInGoodStanding(democHash), true, "democ should now be in good standing");

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


const testCommunityBallots = async ({accounts, owner, svIx, erc20, doLog}) => {
    // test in cases we have a community instance and in cases where
    // they're enabled on a paying democ

    await doLog('start of testCommunityBallots')

    const {args: {democHash, admin}} = getEventFromTxR("DemocAdded", await svIx.dInit(erc20.address, {value: 1}))
    const adminPx = SVAdminPx.at(admin);
    const ixPx = SVIndex.at(admin);

    await doLog('prepped community ballots test')

    assert.equal(await adminPx.getCommunityBallotsEnabled(), true, "comm ballots on by default")
    await doLog('verified comm ballots enabled')

    const [s,e] = genStartEndTimes()
    const packed = mkPacked(s, e, USE_ETH | USE_NO_ENC)
    const packedTimes = toBigNumber(mkPackedTime(s, e));

    await doLog('getting cBallot price')
    const commBPrice = await svIx.getCommunityBallotWeiPrice()
    const commBPriceStr = web3.fromWei(commBPrice.toFixed(), 'ether')
    await doLog(`got cBallot price: ${commBPriceStr}`)

    const user = accounts[3];
    const balPre = await getBalance(user)
    // use extraData as random bytes here for coverage
    const dcbTxr = await adminPx.deployCommunityBallot(genRandomBytes32(), genRandomBytes32(), packedTimes, {value: commBPrice.plus(web3.toWei(1, "ether")), gasPrice: 0, from: user})
    const balPost = await getBalance(user)
    await doLog(`deployed community ballot!`)

    const balPreStr = web3.fromWei(balPre, 'ether')
    const balPostStr = web3.fromWei(balPost, 'ether')
    await doLog(`\nCBallot: ${commBPriceStr}\nBalPre : ${balPreStr}\nBalPost: ${balPostStr}\n`)
    assert.deepEqual(balPre.minus(commBPrice), balPost, "balances should match after community ballot fee")

    await adminPx.setCommunityBallotStatus(false);
    await doLog('set community ballot to false')

    // this should still work because the democ is not in good standing
    await adminPx.deployCommunityBallot(genRandomBytes32(), zeroHash, packedTimes, {value: commBPrice.plus(web3.toWei(1, "ether")), gasPrice: 0, from: user})
    await assertRevert(
        adminPx.deployCommunityBallot(genRandomBytes32(), zeroHash, packedTimes, {value: commBPrice.minus(1), gasPrice: 0, from: user}),
        "should not allow a community ballot with fee below the right amount"
    )

    assert.equal(await svIx.accountInGoodStanding(democHash), false, "account should not be in good standing")
    await doLog('confirmed democ is not in good standing')

    // after this tx the account should be in good standing and this should fail
    await adminPx.sendTransaction({from: user, value: web3.toWei(1, 'ether')})
    await doLog('sent funding tx for democ')

    assert.equal(await svIx.accountInGoodStanding(democHash), true, "account should now be in good standing")
    await doLog('paid 1 ether to democ & confirmed in good standing')

    await assertRevert(
        adminPx.deployCommunityBallot(genRandomBytes32(), zeroHash, packedTimes, {value: commBPrice.plus(web3.toWei(1, "ether")), gasPrice: 0, from: user}),
        "should revert because the democ is now in good standing"
    );
}


const testCurrencyConversion = async ({svIx, paySC, owner, accounts, doLog}) => {
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

    assert.deepEqual(await svIx.getCommunityBallotCentsPrice(), toBigNumber(1000), "community cents price should be $10 init")

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


const testPaymentsEmergencySetOwner = async ({paySC, owner, backupOwner, accounts}) => {
    const [,u1,u2,u3,u4,badActor] = accounts;
    assert.equal(await paySC.emergencyAdmin(), backupOwner, 'emergencyAdmin on paySC init good')
    assert.equal(await paySC.owner(), owner, 'payments owner init good')

    await assertRevert(paySC.emergencySetOwner(badActor, {from: badActor}), 'cannot emergency set owner from bad acct')

    await assertRevert(paySC.emergencySetOwner(u1, {from: owner}), 'owner cannot emergency set owner')
    await paySC.emergencySetOwner(u1, {from: backupOwner})
    assert.equal(await paySC.owner(), u1, 'payment owner changed')
}


const testAllAdminFunctions = async ({owner, accounts, svIx, erc20, doLog}) => {
    const [, u1, u2, u3, u4, u5, badActor, token1] = accounts;
    const {democHash, adminPx, ixPx} = await mkDemoc({svIx, erc20, txOpts: {value: 1}})

    const testOnlyAdmin = async (m, args) => {
        await assertRevert(ixPx[m](...args, {from: badActor}), `ixPx.${m}(${args}, {from: badActor}) fails`)
        await assertRevert(svIx[m](...args, {from: badActor}), `svIx.${m}(${args}, {from: badActor}) fails`)
        await ixPx[m](...args, {from: owner})
    }

    // set erc20
    assert.deepEqual(await svIx.getGErc20ToDemocs(erc20.address), [democHash], 'democHash in erc20 lookup init')
    assert.deepEqual(await svIx.getGErc20ToDemocs(token1), [], 'token1 lookup init []')
    await testOnlyAdmin('setDErc20', [democHash, token1])
    assert.deepEqual(await svIx.getGErc20ToDemocs(erc20.address), [democHash], 'democHash in erc20 lookup')
    assert.deepEqual(await svIx.getGErc20ToDemocs(token1), [democHash], 'democHash in token1 lookup')

    // add category
    assert.equal(await svIx.getDCategoriesN(democHash), 0, 'no cats to start with')
    await testOnlyAdmin('dAddCategory', [democHash, "cat1", false, 0])
    await testOnlyAdmin('dAddCategory', [democHash, "cat2", true, 0])
    await testOnlyAdmin('dAddCategory', [democHash, "cat3", true, 1])
    assert.equal(await svIx.getDCategoriesN(democHash), 3, 'cats created')
    assert.deepEqual(await svIx.getDCategory(democHash, 0), [false, "0x6361743100000000000000000000000000000000000000000000000000000000", false, toBigNumber(0)], 'cat0 created')
    assert.deepEqual(await svIx.getDCategory(democHash, 1), [false, "0x6361743200000000000000000000000000000000000000000000000000000000", true, toBigNumber(0)], 'cat1 created')
    assert.deepEqual(await svIx.getDCategory(democHash, 2), [false, "0x6361743300000000000000000000000000000000000000000000000000000000", true, toBigNumber(1)], 'cat2 created')
    // test they worked

    // deprecate cat - note, deprecation is not recursive
    await testOnlyAdmin('dDeprecateCategory', [democHash, 1])
    assert.deepEqual(await svIx.getDCategory(democHash, 0), [false, "0x6361743100000000000000000000000000000000000000000000000000000000", false, toBigNumber(0)], 'cat0 matches')
    assert.deepEqual(await svIx.getDCategory(democHash, 1), [true, "0x6361743200000000000000000000000000000000000000000000000000000000", true, toBigNumber(0)], 'cat1 deprecated')
    assert.deepEqual(await svIx.getDCategory(democHash, 2), [false, "0x6361743300000000000000000000000000000000000000000000000000000000", true, toBigNumber(1)], 'cat2 matches')

    // upgrade
    assert.equal(await svIx.accountInGoodStanding(democHash), false, 'democ not in good standing yet')
    await svIx.payForDemocracy(democHash, {from: u3, value: oneEth});
    assert.equal(await svIx.accountInGoodStanding(democHash), true, 'democ now in good standing')
    assert.equal(await svIx.accountPremiumAndInGoodStanding(democHash), false, 'democ not premium and in good standing')
    await testOnlyAdmin('dUpgradeToPremium', [democHash])
    assert.equal(await svIx.accountInGoodStanding(democHash), true, 'democ now in good standing')
    assert.equal(await svIx.accountPremiumAndInGoodStanding(democHash), true, 'democ now IS premium and in good standing')

    // downgrade
    await testOnlyAdmin('dDowngradeToBasic', [democHash])
    assert.equal(await svIx.accountInGoodStanding(democHash), true, 'democ still in good standing')
    assert.equal(await svIx.accountPremiumAndInGoodStanding(democHash), false, 'democ no longer premium and in good standing')


    // deploy
    assert.equal(await svIx.getDBallotsN(democHash), 0, '0 ballots')
    await testOnlyAdmin('dDeployBallot', [democHash, genRandomBytes32(), zeroHash, mkStdPacked()])
    assert.equal(await svIx.getDBallotsN(democHash), 1, '1 ballot')
}


const testPrefix = async ({svIx, owner, doLog, ensPR, tld, erc20}) => {
    const {democHash, adminPx, ixPx} = await mkDemoc({svIx, erc20, txOpts: {from: owner, value: 1}})

    const prefixHex = democHash.slice(2, 2 + 26)
    const prefixBase32 = hexToB32(prefixHex)

    assert.equal(await svIx.getDHash("0x" + prefixHex), democHash)

    const prefixNode = nh.hash(prefixBase32 + "." + tld)

    assert.equal(await ensPR.addr(prefixNode), adminPx.address, "prefix.tld lookup for admin SC works")
}


const testCommonRevertCases = async ({svIx, owner, doLog, erc20}) => {
    await assertRevert(IxPayments.new(zeroAddr), "payments throws on zeroAddr")

    const {democHash, adminPx, ixPx} = await mkDemoc({svIx, erc20, txOpts: {value: 1}})

    await assertRevert(svIx.payForDemocracy(democHash, {value: 0}), 'zero payment should revert')
}


const testPremiumUpgradeDowngrade = async ({svIx, owner, doLog, erc20, paySC}) => {
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
    await ixPx.dDowngradeToBasic(democHash)
    assert.deepEqual(await paySC.getAccount(democHash), [false, toBigNumber(0), toBigNumber(0)], 'getAccount matches expectations after null downgrade')
    assert.equal(await paySC.getPremiumStatus(democHash), false, 'not premium 2')

    assert.deepEqual(await paySC.getSecondsRemaining(democHash), toBigNumber(0), 'no seconds remaining')

    // now with payments
    const centsFor30Days = await paySC.getBasicCentsPricePer30Days();
    const weiFor30Days = await paySC.centsToWei(centsFor30Days);
    assert.deepEqual(await paySC.weiToCents(weiFor30Days), toBigNumber(100000), '30 days of wei matches cents expectation')
    await svIx.payForDemocracy(democHash, {value: weiFor30Days})
    const b2 = await getBlock('latest')
    assert.deepEqual(await paySC.getAccount(democHash), [false, toBigNumber(b2.timestamp), toBigNumber(b2.timestamp + 60 * 60 * 24 * 30)], 'getAccount matches after payment')
    assert.reallyClose(await paySC.getSecondsRemaining(democHash), toBigNumber(60 * 60 * 24 * 30), 'should have 30 days left')

    // let's do that upgrade!
    await ixPx.dUpgradeToPremium(democHash)
    await assertRevert(ixPx.dUpgradeToPremium(democHash), 'cannot upgrade to premium twice')
    assert.deepEqual(await paySC.getAccount(democHash), [true, toBigNumber(b2.timestamp), toBigNumber(b2.timestamp + 60 * 60 * 24 * 30 / premMultiplier)], 'getAccount matches after upgrade')
    assert.reallyClose(await paySC.getSecondsRemaining(democHash), toBigNumber(60 * 60 * 24 * 30 / premMultiplier), 'should have 6 days left')

    await svIx.payForDemocracy(democHash, {value: weiFor30Days})
    const b3 = await getBlock('latest')
    assert.deepEqual(await paySC.getAccount(democHash), [true, toBigNumber(b3.timestamp), toBigNumber(b2.timestamp + 2 * 60 * 60 * 24 * 30 / premMultiplier)], 'getAccount matches after upgrade')
    assert.reallyClose(await paySC.getSecondsRemaining(democHash), toBigNumber(2 * 60 * 60 * 24 * 30 / premMultiplier), 'should have 12 days left')

    assert.deepEqual(premPrice30Days, centsFor30Days.times(premMultiplier), 'prices match according to premium multiplier')

    await svIx.payForDemocracy(democHash, {value: premWeiPer30Days})
    const b4 = await getBlock('latest')
    const timeLeft = ((2 + premMultiplier) * 60 * 60 * 24 * 30 / premMultiplier);
    assert.deepEqual(await paySC.getAccount(democHash), [true, toBigNumber(b4.timestamp), toBigNumber(b2.timestamp + timeLeft)], 'getAccount matches after upgrade')
    assert.reallyClose(await paySC.getSecondsRemaining(democHash), toBigNumber(timeLeft), 'should have 42 days left')


    // and test downgrades
    await ixPx.dDowngradeToBasic(democHash)
    await assertRevert(ixPx.dDowngradeToBasic(democHash), 'cant downgrade twice')

    const timeLeft2 = timeLeft * premMultiplier

    // need to split this up b/c the downgrade can have an error of up to 5s due to rounding (which occurs in the _upgrade_ step)
    const [isPrem, lastPaid, paidTill] = await paySC.getAccount(democHash);
    assert.deepEqual([isPrem, lastPaid], [false, toBigNumber(b4.timestamp)], 'getAccount [0:1] matches after downgrade')
    assert.reallyClose(paidTill, toBigNumber(b2.timestamp + timeLeft2), 'getAccount paidTill matches after downgrade', 5)
    assert.reallyClose(await paySC.getSecondsRemaining(democHash), toBigNumber(timeLeft2), 'should have 42*5 days left', 5)


    // check payments log
    assert.deepEqual(await paySC.getPaymentLogN(), toBigNumber(4), 'payment n log as expected')
    assert.deepEqual(await paySC.getPaymentLog(0), [false, democHash, toBigNumber(0), toBigNumber(1)], 'payment 0 matches')
    assert.deepEqual(await paySC.getPaymentLog(1), [false, democHash, toBigNumber(60*60*24*30), weiFor30Days], 'payment 1 matches')
    assert.deepEqual(await paySC.getPaymentLog(2), [false, democHash, toBigNumber(60*60*24*30 / premMultiplier | 0), weiFor30Days], 'payment 2 matches')
    assert.deepEqual(await paySC.getPaymentLog(3), [false, democHash, toBigNumber(60*60*24*30), premWeiPer30Days], 'payment 3 matches')


    await paySC.giveTimeToDemoc(democHash, 100, "a reference")
    assert.deepEqual(await paySC.getPaymentLog(4), [true, democHash, toBigNumber(100), toBigNumber(0)], 'payment 3 matches')
}


const testPaymentsSettingValues = async () => {
    throw Error('')
}


const testPaymentsPayoutAll = async () => {
    throw Error('')
}


const testCatagoriesCrud = async () => {
    // test our ability to create and deprecate catagories
    throw Error('not implemented');
}


const testSponsorshipOfCommunityBallots = async ({svIx, erc20, accounts, owner, bbFarm, doLog}) => {
    const [, dAdmin, u2, u3, u4, u5] = accounts

    await doLog('creating democ')
    const {democHash, adminPx, ixPx} = await mkDemoc({svIx, erc20, txOpts: {from: dAdmin, value: 1}})
    const times = genPackedTime();

    await doLog('getting commb price and verifiying ballotsN === 0')
    const commBPriceEth = await svIx.getCommunityBallotWeiPrice();

    assert.equal(await svIx.getDBallotsN(democHash), 0, 'no ballots yet')

    await doLog('deploying commb')
    const commBTxr = await adminPx.deployCommunityBallot(genRandomBytes32(), zeroHash, times, {from: u2, value: commBPriceEth})
    const {args: {ballotId}} = getEventFromTxR("BallotAdded", commBTxr)
    await doLog(`got commb deployed with ballotId: ${ballotId} (txr: \n${toJson(commBTxr)})`)

    assert.equal(await svIx.getDBallotsN(democHash), 1, 'one ballot so far')

    const ballotIdCmp = await svIx.getDBallotID(democHash, 0);
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


const testNFPTierAndPayments = async () => {
    // test that we can give and remove time on NFP accounts
    throw Error("not implemented");
}


const testBasicExtraBallots = async () => {
    throw Error("not impl")
}


const testManualBallots = async () => {
    throw Error("not impl")
}


const testEmergencyMethods = async ({svIx, accounts, owner, bbFarm, erc20, doLog, be, paySC, pxF, ensPx, ixEnsPx}) => {
    const setTo = accounts[2];

    let hasSetEmergency = false;

    const testAddr = async (property, expectedAddr) =>
        assert.equal(await svIx[property](), expectedAddr, `Address for ${property} (${hasSetEmergency ? 'emergency' : 'init'}) should match expected ${expectedAddr}`)

    const testBadAddr = async (prop) =>
        await assertRevert(svIx[prop](accounts[4], {from: accounts[4]}), `cannot run ${prop} from non-owner account`)

    /* setDAdmin */

    await doLog(`testing emergencySetDAdmin`)
    // test emergency set for democ - need to do this BEFORE setting backend to bad addr...
    const democAdmin = accounts[1];
    const badActor = accounts[4];
    const {democHash, adminPx, ixPx} = await mkDemoc({svIx, erc20, txOpts: {from: democAdmin, value: 1}})
    await doLog(`democ created.`)

    assert.equal(await svIx.getDAdmin(democHash), adminPx.address, "d admin should match")

    await doLog(`running emergencySetDAdmin`)
    await svIx.emergencySetDAdmin(democHash, setTo)
    assert.equal(await svIx.getDAdmin(democHash), setTo, "d admin should match after emergency")

    await assertRevert(svIx.emergencySetDAdmin(democHash, badActor, {from: badActor}), 'cannot emergency set admin for democ from bad acct')

    /* Other emergency methods */

    await doLog(`done. about to test init conditions for emergency methods`)

    await testAddr('backend', be.address)
    await testAddr('payments', paySC.address)
    await testAddr('bbfarm', bbFarm.address)
    await testAddr('adminPxFactory', pxF.address)

    await doLog(`init conditions validated. testing emergency set methods`)

    await svIx.emergencySetPaymentBackend(setTo)
    await svIx.emergencySetBackend(setTo)
    await svIx.emergencySetAdminPxFactory(setTo)
    await svIx.emergencySetBBFarm(setTo)
    hasSetEmergency = true;

    await doLog(`emergency set methods tested. testing setting from bad addrs`)

    await testBadAddr('emergencySetPaymentBackend')
    await testBadAddr('emergencySetBackend')
    await testBadAddr('emergencySetAdminPxFactory')
    await testBadAddr('emergencySetBBFarm')

    await doLog(`setting from bad addrs tested. validating results`)

    await testAddr('backend', setTo)
    await testAddr('payments', setTo)
    await testAddr('bbfarm', setTo)
    await testAddr('adminPxFactory', setTo)

    await doLog(`results validated.`)

    await doLog(`done`)
}



/* bb farm won - by a lot
    Std:  1392871
    Lib:  1310372
    NoSC: 155579
    BBFarm: 274586
*/

const testGasOfBallots = async ({svIx, owner, erc20}) => {
    const {democHash, adminPx, ixPx} = await mkDemoc({svIx, txOpts: {from: owner, value: 1}, erc20});
    const packed = toBigNumber(mkStdPacked());

    const b1 = await getBalance(owner)

    await ixPx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, packed)

    const b2 = await getBalance(owner)

    console.log(`Deploy Ballot Gas Costs:
    BBFarm: ${b1.minus(b2).toFixed()}
    `)
}


contract("SVLightIndex", function (accounts) {
    tests = [
        ["common revert cases", testCommonRevertCases],
        ["test premium upgrade and downgrade", testPremiumUpgradeDowngrade],
        ["test payments setting values", testPaymentsSettingValues],
        ["test payments payout all", testPaymentsPayoutAll],
        ["test paying for extra ballots (basic)", testBasicExtraBallots],
        ["test catagories (crud)", testCatagoriesCrud],
        ["test nfp tier", testNFPTierAndPayments],
        ["test manually add ballots", testManualBallots],
        ["test democ prefix stuff", testPrefix],
        ["test all admin functions", testAllAdminFunctions],
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
