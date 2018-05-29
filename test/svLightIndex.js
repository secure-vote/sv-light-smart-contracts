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


const testInit = async ({paySC, owner, svIx}) => {
    // just test the initialization params and sanity check

    /**
     * To test:
     * - payments.payTo
     * - owner on SCs
     * - other stuff?
     */

    assert.equal(await paySC.getPayTo(), owner, "payTo should be correct on paymentSC")
    assert.equal(await paySC.owner(), owner, "owner on paymentSC")
    assert.equal(await svIx.owner(), owner, "owner on svIx")
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


    // test setExchAddr
    // test set exchange rate
    // test expected for certain exchange rates
    // test under different exchange rates

    const weiPerCent1 = await paySC.getWeiPerCent();
    assert.deepEqual(weiPerCent1, toBigNumber('18975332000000'), 'wei per cent matches init expectations')
    assert.deepEqual(await paySC.getUsdEthExchangeRate(), toBigNumber(52700), 'usd/eth init matches expected')

    await testWeiAndPrices();

    await doLog('set exchange rate to $666usd/eth')
    await paySC.setWeiPerCent(toBigNumber('15015015000000'))
    const weiPerCent2 = await paySC.getWeiPerCent();
    assert.deepEqual(weiPerCent2, toBigNumber('15015015000000'), 'wei per cent matches init expectations')
    assert.deepEqual(await paySC.getUsdEthExchangeRate(), toBigNumber(66600), 'usd/eth init matches expected')

    await testWeiAndPrices();

    await paySC.setMinorEditsAddr(minorEdits);

    await doLog('set exchange rate to $9001usd/eth')
    await paySC.setWeiPerCent(toBigNumber('1110987600000'), {from: minorEdits})
    const weiPerCent3 = await paySC.getWeiPerCent();
    assert.deepEqual(weiPerCent3, toBigNumber('1110987600000'), 'wei per cent matches init expectations')
    assert.deepEqual(await paySC.getUsdEthExchangeRate(), toBigNumber(900100), 'usd/eth init matches expected')

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


const testPremiumUpgradeDowngrade = async () => {
    throw Error('not implemented');

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
        // ["test premium upgrade and downgrade", testPremiumUpgradeDowngrade],
        // ["test paying for extra ballots (basic)", testBasicExtraBallots],
        // ["test catagories (crud)", testCatagoriesCrud],
        // ["test nfp tier", testNFPTierAndPayments],
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
