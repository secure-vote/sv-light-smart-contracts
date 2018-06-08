const SVIndex = artifacts.require("./SVIndex");
const SVIxBackend = artifacts.require("./SVIndexBackend");
const SVPayments = artifacts.require("./SVPayments");
const EnsPx = artifacts.require("./SvEnsEverythingPx");
const EnsPR = artifacts.require("./PublicResolver");
const EnsRegistrar = artifacts.require("./SvEnsRegistrar");
const EnsRegistry = artifacts.require("./SvEnsRegistry");
const EnsOwnerPx = artifacts.require("./EnsOwnerProxy");
const EmitterTesting = artifacts.require("./EmitterTesting");
const TestHelper = artifacts.require("./TestHelper");
const FaucetErc20 = artifacts.require("./FaucetErc20");
const BBFarm = artifacts.require("./BBFarm")
const BBFarmTesting = artifacts.require("./BBFarmTesting")
const CommunityAuctionSimple = artifacts.require("./CommunityAuctionSimple")
const ControlledTest = artifacts.require("./ControlledTest")
const payoutAllTest = artifacts.require("./payoutAllCSettableTest")

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
        await doLog(`created bbfarm ${bbFarm.address}`)

        const ixBackend = await SVIxBackend.new();
        await doLog(`Created backend... ${ixBackend.address}`);
        const ixPayments = await SVPayments.new(backupOwner);
        await doLog(`Created payments backend... ${ixPayments.address}`);

        const commBSimple = await CommunityAuctionSimple.new();

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

        const svIx = await SVIndex.new(ixBackend.address, ixPayments.address, ixEnsPx.address, bbFarm.address, commBSimple.address, {gasPrice: 0});
        await doLog(`Created svIx at ${svIx.address}`)

        await ixEnsPx.setAddr(svIx.address);
        await ixEnsPx.setAdmin(svIx.address, true);
        const ixEnsResolution = await ensPR.addr(indexNH);
        await doLog(`index.${tld} now resolves to ${ixEnsResolution}`)
        assert.equal(ixEnsResolution, svIx.address, "ixEns should resolve to ix")

        await ixBackend.setPermissions(svIx.address, true);
        await ixBackend.doLockdown();

        await bbFarm.setPermissions(svIx.address, true);

        await ixPayments.setPermissions(svIx.address, true);
        await ixPayments.doLockdown();

        await doLog("set permissions for backend and paymentSettings - allow svIx")

        await assertErrStatus(ERR_ADMINS_LOCKED_DOWN, ixBackend.setPermissions(svIx.address, true), "should throw error after lockdown (ixBackend)")
        await assertErrStatus(ERR_ADMINS_LOCKED_DOWN, ixPayments.setPermissions(svIx.address, true), "should throw error after lockdown (ixPayments)")

        await doLog("asserted that setPermissions fails after lockdown")

        await ensPx.setAdmin(svIx.address, true);

        await doLog("added svIx as admin to ensPx")

        await doLog(`accounts[0]: ${accounts[0]}`)
        await doLog(`ixPayments owner: ${await ixPayments.owner()}`)
        await doLog(`ixBackend owner:    ${await ixBackend.owner()}`)
        await doLog(`svId owner:  ${await svIx.owner()}`)

        const erc20 = await FaucetErc20.new();
        await doLog(`Created erc20 w faucet at ${erc20.address}`)

        await doLog('>>> FINISHED SETUP <<<')

        loggingActive = true;
        return await f({doLog, svIx, ixBackend, bbFarm, commBSimple, ixPayments, scLog, tld, ensPR, ensRrr, ensPx, ensRry, ixEnsPx, erc20, backupOwner, owner, accounts}, accounts);
    };
};


/* UTILITY FUNCTIONS */

const mkDemoc = async ({svIx, txOpts, erc20}) => {
    assert.equal(txOpts.value && txOpts.value > 0, true, "must have value when making democ")
    const addr = erc20.address || erc20;
    const createTx = await svIx.dInit(addr, false, txOpts);
    const {args: {democHash}} = getEventFromTxR("NewDemoc", createTx);
    const {args: {owner: dOwner}} = getEventFromTxR("DemocOwnerSet", createTx);
    return {democHash, dOwner};
}


/* ACTUAL TESTS */

const testUpgrade = async ({svIx, ensPx, ixPayments, ixBackend, ixEnsPx, pxF, bbFarm, owner, erc20, doLog, commBSimple}) => {
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

    const {democHash} = await mkDemoc({svIx, erc20, txOpts: {from: owner, value: 1}})

    // upgrade proper
    const newIx = await SVIndex.new(ixBackend.address, ixPayments.address, ixEnsPx.address, bbFarm.address, commBSimple.address);

    await svIx.doUpgrade(newIx.address);

    await assertRevert(svIx.doUpgrade(zeroAddr), "upgrade cannot ixBackend performed twice");

    assert.equal(await ixBackend.hasPermissions(newIx.address), true, "new ix should have BE permissions");
    assert.equal(await ixPayments.hasPermissions(newIx.address), true, "new ix should have payments permissions");
    assert.equal(await bbFarm.hasPermissions(newIx.address), true, "new ix should have bbfarm permissions");
    assert.equal(await ixEnsPx.isAdmin(newIx.address), true, "new ix should have ixEnsPx permissions");
    assert.equal(await commBSimple.upgrades(svIx.address), newIx.address, "simple commb auction contract upgraded");

    assert.equal(await ixBackend.hasPermissions(svIx.address), false, "old ix should not have BE permissions");
    assert.equal(await ixPayments.hasPermissions(svIx.address), false, "old ix should not have payments permissions");
    assert.equal(await bbFarm.hasPermissions(svIx.address), false, "old ix should not have bbfarm permissions");
    assert.equal(await ixEnsPx.isAdmin(svIx.address), false, "old ix should not have ixEnsPx permissions");

    assert.equal(await svIx.getUpgradePointer(), newIx.address, "svIx.getUpgradePointer should point to new ix");
}


const testInit = async ({ixPayments, owner, svIx, erc20, doLog, ixBackend, bbFarm}) => {
    // just test the initialization params and sanity check

    assert.equal(await ixPayments.getPayTo(), owner, "payTo should ixBackend correct on paymentSC")
    assert.equal(await ixPayments.getPayTo(), owner, "payTo should ixBackend correct on ix")
    assert.equal(await ixPayments.owner(), owner, "owner on paymentSC")
    assert.equal(await svIx.owner(), owner, "owner on svIx")

    await doLog('checked payto and owner')

    assert.equal(await ixBackend.getGDemocsN(), 0, 'no democs yet')

    await doLog('checked getGDemocs')

    assert.deepEqual(await ixBackend.getGErc20ToDemocs(erc20.address), [], 'empty list for erc20 lookup')

    await doLog('checked getGErc20ToDemocs')

    const {democHash} = await mkDemoc({svIx, erc20, txOpts: {from: owner, value: oneEth.div(100)}})
    const {democHash: democHash2} = await mkDemoc({svIx, erc20, txOpts: {from: owner, value: oneEth.div(100)}})

    await doLog('created 2x democs')

    assert.equal(await ixBackend.getGDemocsN(), 2, '2 democs now')
    assert.equal(await ixBackend.getGDemoc(0), democHash, 'democ 0 has expected hash')
    assert.equal(await ixBackend.getGDemoc(1), democHash2, 'democ 1 has expected hash')

    assert.deepEqual(await ixBackend.getGErc20ToDemocs(erc20.address), [democHash, democHash2], 'erc20 lookup gives us our democs')

    assert.deepEqual(await ixBackend.getDInfo(democHash), [erc20.address, owner, toBigNumber(0)], 'getDInfo works as expected (0)')
    const specHash = genRandomBytes32()
    await svIx.dDeployBallot(democHash, specHash, zeroHash, await mkStdPacked())
    assert.deepEqual(await ixBackend.getDInfo(democHash), [erc20.address, owner, toBigNumber(1)], 'getDInfo works as expected (1)')

    await assertRevert(svIx.dDeployBallot(democHash, specHash, zeroHash, await mkStdPacked()), 'deploying a ballot with same spechash should revert')

    // test getVersion on ix, ixBackend, ixPayments, BBFarm
    assert.deepEqual(await svIx.getVersion(), toBigNumber(2), 'ix ver')
    assert.deepEqual(await ixBackend.getVersion(), toBigNumber(2), 'ixBackend ver')
    assert.deepEqual(await ixPayments.getVersion(), toBigNumber(2), 'ixPayments ver')
    assert.deepEqual(await bbFarm.getVersion(), toBigNumber(2), 'bbFarm ver')
}


const testCreateDemoc = async ({accounts, svIx, erc20, tld, ensPR, scLog, owner, ixBackend, doLog, ixPayments}) => {
    const [user0, u1, u2, u3, u4, u5, u6] = accounts;

    const {democHash, dOwner} = await mkDemoc({svIx, erc20, txOpts: {from: u1, value: oneEth}})

    await scLog.log(`Created democ w hash ${democHash} and owner ${dOwner}`)

    // test some adminProps
    assert.equal(await ixBackend.isDEditor(democHash, u1), true, "user1 should be editor to start with");
    assert.equal(await ixBackend.getDOwner(democHash), u1, "user1 should be owner to start with");
    await svIx.setDOwner(democHash, u2, {from: u1});
    assert.equal(await ixBackend.isDEditor(democHash, u1), true, "user1 is still editor (not owner)");
    assert.equal(await ixBackend.isDEditor(democHash, u2), true, "user2 is editor (owner)");
    assert.equal(await ixBackend.getDOwner(democHash), u2, "user2 now owner");
    await svIx.setDEditor(democHash, u1, false, {from: u2})
    assert.equal(await ixBackend.isDEditor(democHash, u1), false, "user1 should not be editor 3984");
    await svIx.setDEditor(democHash, u1, true, {from: u2})
    assert.equal(await ixBackend.isDEditor(democHash, u1), true, "user1 should be editor again 2345");

    // test ercOwnerClaim
    await doLog("about to test owner erc20 claim")
    assert.equal(await ixBackend.isDEditor(democHash, owner), false, "erc20 owner not admin by default");
    await svIx.dOwnerErc20Claim(democHash, {from: owner});

    assert.equal(await ixBackend.isDEditor(democHash, owner), true, "erc20 owner claim works (editor)");
    assert.equal(await ixBackend.getDOwner(democHash), owner, "erc20 owner claim works");
    await assertRevert(svIx.dOwnerErc20Claim(democHash, {from: u2}), "erc20 owner can't claim if now actual owner")

    await doLog("about to test owner erc20 claim while disabled")
    // test disable
    const {democHash: dh2} = await mkDemoc({svIx, erc20, txOpts: {from: u2, value: oneEth}})

    assert.equal(await ixBackend.getDErc20OwnerClaimEnabled(dh2), true, 'erc20 owner claim enabled by default')
    await svIx.dDisableErc20OwnerClaim(dh2, {from: u2})
    await assertRevert(svIx.dOwnerErc20Claim(dh2, {from: owner}), "erc20 owner can't claim if feature disabled")

    await svIx.dInit(erc20.address, true, {value: 1})  // create a democ where erc20 owner claims prohibited
    assert.equal(await ixBackend.getDErc20OwnerClaimEnabled(dh2), false, 'erc20 owner claim can be disabled on dInit')

    await doLog("about to test controller erc20 claim")
    // test controller
    const controlled = await ControlledTest.new({from: u1});
    assert.equal(await controlled.controller(), u1, 'user1 is controller')

    const {democHash: dh3} = await mkDemoc({svIx, erc20: controlled, txOpts: {from: u2, value: oneEth}})
    await doLog(`about to claim owner for controlled token with u1 ${u1}`)
    await assertRevertF(() => svIx.dOwnerErc20Claim(dh3, {from: u4}), 'not controller = no claim')
    await svIx.dOwnerErc20Claim(dh3, {from: u1}) // "erc20 controller can claim"
    await assertRevertF(() => svIx.dOwnerErc20Claim(dh3, {from: u1}), 'disabled after use')
    assert.equal(await ixBackend.getDOwner(dh3), u1, 'user1 is owner now!');

    const th = await TestHelper.new()  // use this bc it has no controller or owner method
    const d4 = await mkDemoc({svIx, erc20: th, txOpts: {from: u2, value: oneEth}})
    await assertRevertF(() => svIx.dOwnerErc20Claim(d4.democHash, {from: u4}), 'no owner or controller method = no claim')

    // test minWeiForDInit
    const newMinWei = toBigNumber(100);
    await ixPayments.setMinWeiForDInit(newMinWei);
    assert.deepEqual(await ixPayments.getMinWeiForDInit(), newMinWei, 'new min wei for d init works')
    await assertRevert(mkDemoc({svIx, erc20, txOpts: {value: newMinWei.minus(1)}}), 'fails if value sent below minWei')
    await mkDemoc({svIx, erc20, txOpts: {value: newMinWei}}) // this works
}


const testPaymentsForDemoc = async ({accounts, svIx, erc20, ixPayments, owner, scLog, ixBackend}) => {
    // test that payments behave as expected

    // for simplicity we should set the exchange rate to something simple
    // this means 10^14 wei per 1c => 1 eth per $100
    await ixPayments.setWeiPerCent(toBigNumber(oneEth.div(10000)), {from: owner});
    // set cents price per 30 days to $1000.00
    await ixPayments.setBasicCentsPricePer30Days(100000, {from: owner});
    await assertRevert(ixPayments.setWeiPerCent(1, {from: accounts[2]}), "can't set wei from non-admin account");
    await scLog.log("set exchange rate")

    await scLog.log(`${await ixPayments.weiBuysHowManySeconds(toBigNumber('1e13'))}`)
    await scLog.log(`${await ixPayments.weiBuysHowManySeconds(toBigNumber('1e18'))}`)

    const oneEthShouldBuy = await ixPayments.weiBuysHowManySeconds(toBigNumber(oneEth));
    // this should ixBackend 10% of 30 days
    assert.equal(oneEthShouldBuy.toNumber(), 3 * 24 * 60 * 60, "one eth should buy 3 days with testing params");
    await scLog.log("1 eth buys correct number of days");

    const user1 = accounts[1];

    // create the democ with an absurdly small fee -
    const {democHash, dOwner} = await mkDemoc({svIx, erc20, txOpts: {from: user1, value: 1}});
    assert.equal(await ixPayments.accountInGoodStanding(democHash), false, "democ should not ixBackend in good standing with such a small fee");
    await scLog.log("Created democ and ensured it's not in good standing");

    await ixPayments.payForDemocracy(democHash, {from: user1, value: oneEth});
    assert.equal(await ixPayments.accountInGoodStanding(democHash), true, "democ should now ixBackend in good standing");

    const secRemaining = await ixPayments.getSecondsRemaining(democHash);
    assert.equal(oneEthShouldBuy - secRemaining < 10, true, "should have correct time remaining to within 10s")

    // some random sending $ for democ
    await ixPayments.payForDemocracy(democHash, {from: accounts[2], value: oneEth});

    const secRemaining2 = await ixPayments.getSecondsRemaining(democHash);
    assert.equal(2 * oneEthShouldBuy - secRemaining2 < 10, true, "should have correct time remaining (again) to within 10s")

    // check payments work via owner balance
    const balPre = await getBalance(owner);
    await ixPayments.sendTransaction({from: accounts[2], value: oneEth});
    assert.deepEqual(balPre.plus(toBigNumber(oneEth)), await getBalance(owner), `ixPayments fallback works (pre-balance: ${balPre.toString()}`);
}


const testCommunityBallots = async ({accounts, owner, svIx, erc20, doLog, ixPayments, ixBackend, commBSimple}) => {
    // test in cases we have a community instance and in cases where
    // they're enabled on a paying democ

    await doLog('start of testCommunityBallots')

    const {democHash, dAdmin} = await mkDemoc({svIx, erc20, txOpts: {value: 1}})

    await doLog('prepped community ballots test')

    assert.equal(await ixBackend.getDCommBallotsEnabled(democHash), true, "comm ballots on by default")
    await doLog('verified comm ballots enabled')

    const [s,e] = await genStartEndTimes()
    const packed = mkPacked(s, e, USE_ETH | USE_NO_ENC)
    const packedTimes = toBigNumber(mkPackedTime(s, e));

    await doLog('getting cBallot price')
    const commBPrice = await commBSimple.getNextPrice(democHash)
    const commBPriceStr = web3.fromWei(commBPrice.toFixed(), 'ether')
    await doLog(`got cBallot price: ${commBPriceStr}`)

    const user = accounts[3];
    const balPre = await getBalance(user)
    // use extraData as random bytes here for coverage
    const dcbTxr = await svIx.dDeployCommunityBallot(democHash, genRandomBytes32(), zeroHash, packedTimes, {value: commBPrice.plus(web3.toWei(1, "ether")), gasPrice: 0, from: user})
    const balPost = await getBalance(user)
    await doLog(`deployed community ballot!`)

    const balPreStr = web3.fromWei(balPre, 'ether')
    const balPostStr = web3.fromWei(balPost, 'ether')
    await doLog(`\nCBallot: ${commBPriceStr}\nBalPre : ${balPreStr}\nBalPost: ${balPostStr}\n`)
    assert.deepEqual(balPre.minus(commBPrice), balPost, "balances should match after community ballot fee (includes refund)")

    await svIx.dSetCommunityBallotsEnabled(democHash, false);
    await doLog('set community ballot to false')

    // this should still work because the democ is not in good standing
    await svIx.dDeployCommunityBallot(democHash, genRandomBytes32(), zeroHash, packedTimes, {value: commBPrice.plus(web3.toWei(1, "ether")), gasPrice: 0, from: user})
    await assertRevert(
        svIx.dDeployCommunityBallot(democHash, genRandomBytes32(), zeroHash, packedTimes, {value: commBPrice.minus(1), gasPrice: 0, from: user}),
        "should not allow a community ballot with fee below the right amount"
    )

    assert.equal(await ixPayments.accountInGoodStanding(democHash), false, "account should not ixBackend in good standing")
    await doLog('confirmed democ is not in good standing')

    // after this tx the account should ixBackend in good standing and this should fail
    await ixPayments.payForDemocracy(democHash, {from: user, value: web3.toWei(1, 'ether')})
    await doLog('sent funding tx for democ')

    assert.equal(await ixPayments.accountInGoodStanding(democHash), true, "account should now ixBackend in good standing")
    await doLog('paid 1 ether to democ & confirmed in good standing')

    await assertRevert(
        svIx.dDeployCommunityBallot(democHash, genRandomBytes32(), zeroHash, packedTimes, {value: commBPrice.plus(web3.toWei(1, "ether")), gasPrice: 0, from: user}),
        "should revert because the democ is now in good standing but commB disabled"
    );

    const secsRemaining = (await ixPayments.getSecondsRemaining(democHash)).toNumber()
    await increaseTime(secsRemaining + 10)
    // send a tx so we make sure the last block has the new timestamps
    await sendTransaction({to: accounts[1], from: accounts[0], value: 1})
    const b = await getBlock('latest')
    const packedTimes2 = await genPackedTime()

    assert.equal(await ixPayments.accountInGoodStanding(democHash), false, "time now expired")
    // commb works again
    await svIx.dDeployCommunityBallot(democHash, genRandomBytes32(), zeroHash, packedTimes2, {value: commBPrice})

    // set up to test counting of ballots when it does qualify as a community ballot but
    // community ballots are disabled (and democ in good standing)
    const count1 = await ixBackend.getDCountedBasicBallotsN(democHash);
    await svIx.dSetCommunityBallotsEnabled(democHash, true);
    await ixPayments.payForDemocracy(democHash, {value: oneEth})  // now in good standing
    await doLog('paid for democ in prep of checking commb count')

    const [s2, e2] = await genStartEndTimes()

    // price stuff
    assert.deepEqual(await commBSimple.getNextPrice(democHash), toBigNumber('1666666666000000'), 'community ballot should cost 1666666666000000 wei - init price')
    await commBSimple.setPriceWei('1', {from: owner})
    assert.deepEqual(await commBSimple.getNextPrice(democHash), toBigNumber('1'), 'community ballot should cost 1 - updated')
    assert.deepEqual(await commBSimple.getBallotLogN(svIx.address), toBigNumber('3'), 'commBSimple.getBallotLogN should give back 3 atm')
}


const testCurrencyConversion = async ({svIx, ixPayments, owner, accounts, doLog, ixBackend}) => {
    // test our payment code around eth/usd stuff

    const [,minorEdits,u2,u3,u4,u5] = accounts;

    const centsPer30Days = await ixPayments.getBasicCentsPricePer30Days()
    const initCentsPer30Days = toBigNumber(125000)

    const testWeiAndPrices = async () => {
        const weiPerCent = await ixPayments.getWeiPerCent();
        assert.deepEqual(await ixPayments.weiBuysHowManySeconds(weiPerCent.times(centsPer30Days)), toBigNumber(60 * 60 * 24 * 30), '30dayPrice x weiPerCent should buy 30 days')
        assert.deepEqual(await ixPayments.weiBuysHowManySeconds(weiPerCent.times(centsPer30Days.div(2))), toBigNumber(60 * 60 * 24 * 15), '0.5 x 30dayPrice x weiPerCent should buy 15 days')
        assert.deepEqual(await ixPayments.weiBuysHowManySeconds(weiPerCent.times(centsPer30Days.times(2))), toBigNumber(60 * 60 * 24 * 60), '2 x 30dayPrice x weiPerCent should buy 60 days')

        assert.deepEqual(await ixPayments.getBasicCentsPricePer30Days(), toBigNumber(initCentsPer30Days), 'basic costs $12500/mo or $125k cents / mo')

        const basicBallotsPerMonth = await ixPayments.getBasicBallotsPer30Days()
        assert.deepEqual(basicBallotsPerMonth, toBigNumber(10), 'basic ballots per month is 10 at start')
        assert.deepEqual(await ixPayments.getBasicExtraBallotFeeWei(), weiPerCent.times(centsPer30Days).div(basicBallotsPerMonth), 'extra ballot should cost approx 1/nth of basic price where n is how many ballots pe rmonth they get')
    }

    // test setExchAddr
    // test set exchange rate
    // test expected for certain exchange rates
    // test under different exchange rates

    const weiPerCent1 = await ixPayments.getWeiPerCent();
    assert.deepEqual(weiPerCent1, toBigNumber('16583747000000'), 'wei per cent matches init expectations')
    assert.deepEqual(await ixPayments.getUsdEthExchangeRate(), toBigNumber(60300), 'usd/eth init matches expected')
    assert.deepEqual(await ixPayments.weiToCents(weiPerCent1), toBigNumber(1), '1 cent sanity check init')

    await testWeiAndPrices();

    await doLog('set exchange rate to $666usd/eth')
    await ixPayments.setWeiPerCent(toBigNumber('15015015000000'))
    const weiPerCent2 = await ixPayments.getWeiPerCent();
    assert.deepEqual(weiPerCent2, toBigNumber('15015015000000'), 'wei per cent matches init expectations')
    assert.deepEqual(await ixPayments.getUsdEthExchangeRate(), toBigNumber(66600), 'usd/eth init matches expected')
    assert.deepEqual(await ixPayments.weiToCents(weiPerCent2), toBigNumber(1), '1 cent sanity check 2')

    await testWeiAndPrices();

    await ixPayments.setMinorEditsAddr(minorEdits);

    await doLog('set exchange rate to $9001usd/eth')
    await ixPayments.setWeiPerCent(toBigNumber('1110987600000'), {from: minorEdits})
    const weiPerCent3 = await ixPayments.getWeiPerCent();
    assert.deepEqual(weiPerCent3, toBigNumber('1110987600000'), 'wei per cent matches init expectations')
    assert.deepEqual(await ixPayments.getUsdEthExchangeRate(), toBigNumber(900100), 'usd/eth init matches expected')
    assert.deepEqual(await ixPayments.weiToCents(weiPerCent3), toBigNumber(1), '1 cent sanity check 3')
    assert.deepEqual(await ixPayments.weiToCents(weiPerCent3.times(2)), toBigNumber(2), '2 cent sanity check @ 3')
    assert.deepEqual(await ixPayments.weiToCents(weiPerCent3.times(1.7)), toBigNumber(1), '1 cent rounding check')

    await testWeiAndPrices();

    await assertRevert(ixPayments.setWeiPerCent(toBigNumber('111'), {from: u3}), 'cannot set exchange rate from bad acct')
}


const testPaymentsEmergencySetOwner = async ({ixPayments, owner, backupOwner, accounts, ixBackend}) => {
    const [,u1,u2,u3,u4,badActor] = accounts;
    assert.equal(await ixPayments.emergencyAdmin(), backupOwner, 'emergencyAdmin on ixPayments init good')
    assert.equal(await ixPayments.owner(), owner, 'payments owner init good')

    await assertRevert(ixPayments.emergencySetOwner(badActor, {from: badActor}), 'cannot emergency set owner from bad acct')

    await assertRevert(ixPayments.emergencySetOwner(u1, {from: owner}), 'owner cannot emergency set owner')
    await ixPayments.emergencySetOwner(u1, {from: backupOwner})
    assert.equal(await ixPayments.owner(), u1, 'payment owner changed')
}


const testAllAdminFunctionsAndCategories = async ({owner, accounts, svIx, erc20, doLog, ixPayments, ixBackend}) => {
    const [, u1, u2, u3, u4, u5, badActor, token1] = accounts;
    const {democHash} = await mkDemoc({svIx, erc20, txOpts: {value: 1}})

    const testOnlyAdmin = async (m, args) => {
        await assertRevert(svIx[m](...args, {from: badActor}), `svIx.${m}(${args}, {from: badActor}) fails`)
        await svIx[m](...args, {from: owner})
    }

    const testOnlyAdminPayments = async (m, args) => {
        await assertRevert(ixPayments[m](...args, {from: badActor}), `payments.${m}(${args}, {from: badActor}) fails`)
        await ixPayments[m](...args, {from: owner})
    }

    const testOnlyAdminBackend = async (m, args) => {
        await assertRevert(ixBackend[m](...args, {from: badActor}), `backend.${m}(${args}, {from: badActor}) fails`)
        await ixBackend[m](...args, {from: owner})
    }

    // set erc20
    assert.deepEqual(await ixBackend.getGErc20ToDemocs(erc20.address), [democHash], 'democHash in erc20 lookup init')
    assert.deepEqual(await ixBackend.getGErc20ToDemocs(token1), [], 'token1 lookup init []')
    await testOnlyAdmin('setDErc20', [democHash, token1])
    assert.deepEqual(await ixBackend.getGErc20ToDemocs(erc20.address), [democHash], 'democHash in erc20 lookup')
    assert.deepEqual(await ixBackend.getGErc20ToDemocs(token1), [democHash], 'democHash in token1 lookup')

    // add category
    assert.equal(await ixBackend.getDCategoriesN(democHash), 0, 'no cats to start with')
    await testOnlyAdmin('dAddCategory', [democHash, "cat1", false, 0])
    await testOnlyAdmin('dAddCategory', [democHash, "cat2", true, 0])
    await testOnlyAdmin('dAddCategory', [democHash, "cat3", true, 1])
    assert.equal(await ixBackend.getDCategoriesN(democHash), 3, 'cats created')
    assert.deepEqual(await ixBackend.getDCategory(democHash, 0), [false, "0x6361743100000000000000000000000000000000000000000000000000000000", false, toBigNumber(0)], 'cat0 created')
    assert.deepEqual(await ixBackend.getDCategory(democHash, 1), [false, "0x6361743200000000000000000000000000000000000000000000000000000000", true, toBigNumber(0)], 'cat1 created')
    assert.deepEqual(await ixBackend.getDCategory(democHash, 2), [false, "0x6361743300000000000000000000000000000000000000000000000000000000", true, toBigNumber(1)], 'cat2 created')
    // test they worked

    // deprecate cat - note, deprecation is not recursive
    await testOnlyAdmin('dDeprecateCategory', [democHash, 1])
    assert.deepEqual(await ixBackend.getDCategory(democHash, 0), [false, "0x6361743100000000000000000000000000000000000000000000000000000000", false, toBigNumber(0)], 'cat0 matches')
    assert.deepEqual(await ixBackend.getDCategory(democHash, 1), [true, "0x6361743200000000000000000000000000000000000000000000000000000000", true, toBigNumber(0)], 'cat1 deprecated')
    assert.deepEqual(await ixBackend.getDCategory(democHash, 2), [false, "0x6361743300000000000000000000000000000000000000000000000000000000", true, toBigNumber(1)], 'cat2 matches')

    // upgrade
    assert.equal(await ixPayments.accountInGoodStanding(democHash), false, 'democ not in good standing yet')
    await ixPayments.payForDemocracy(democHash, {from: u3, value: oneEth});
    assert.equal(await ixPayments.accountInGoodStanding(democHash), true, 'democ now in good standing')
    assert.equal(await ixPayments.getPremiumStatus(democHash), false, 'democ not premium and in good standing')
    await testOnlyAdmin('dUpgradeToPremium', [democHash])
    assert.equal(await ixPayments.accountInGoodStanding(democHash), true, 'democ now in good standing')
    assert.equal(await ixPayments.getPremiumStatus(democHash), true, 'democ now IS premium and in good standing')

    // downgrade
    await increaseTime(60 * 60 * 24 + 10)  // allow downgrade to work
    await testOnlyAdmin('dDowngradeToBasic', [democHash])
    assert.equal(await ixPayments.accountInGoodStanding(democHash), true, 'democ still in good standing')
    assert.equal(await ixPayments.getPremiumStatus(democHash), false, 'democ no longer premium and in good standing')


    // deploy
    assert.equal(await ixBackend.getDBallotsN(democHash), 0, '0 ballots')
    await testOnlyAdmin('dDeployBallot', [democHash, genRandomBytes32(), zeroHash, await mkStdPacked()])
    assert.equal(await ixBackend.getDBallotsN(democHash), 1, '1 ballot')

    // setting democ owner
    assert.equal(await ixBackend.getDOwner(democHash), owner, 'owner init')
    await testOnlyAdmin('setDOwner', [democHash, u1])
    assert.equal(await ixBackend.getDOwner(democHash), u1, 'owner changes')
    await svIx.setDOwner(democHash, owner, {from: u1})

    // setting democ editors
    assert.equal(await ixBackend.isDEditor(democHash, u2), false, 'u2 not editor to start w')
    await testOnlyAdmin('setDEditor', [democHash, u2, true])
    assert.equal(await ixBackend.isDEditor(democHash, u2), true, 'u2 now editor')

    // calling editor reset
    await testOnlyAdmin('setDNoEditors', [democHash])
    assert.equal(await ixBackend.isDEditor(democHash, u2), false, 'u2 not editor anymore')
    assert.equal(await ixBackend.isDEditor(democHash, owner), true, 'but owner still is editor (owner is always counted as editor)')

    // payments
    await Promise.all(R.map(testArgs => testOnlyAdminPayments(...testArgs),
        [ [ 'giveTimeToDemoc', [zeroHash, 1000, "0x00"] ]
        , [ 'setPayTo', [owner] ]
        , [ 'setBasicCentsPricePer30Days', [toBigNumber(999)] ]
        , [ 'setBasicBallotsPer30Days', [toBigNumber(999)] ]
        , [ 'setPremiumMultiplier', [toBigNumber(25)] ]
        , [ 'setWeiPerCent', [toBigNumber(999)] ]
        , [ 'setMinorEditsAddr', [zeroAddr] ]
        , [ 'setDenyPremium', [zeroHash, true] ]
        ]));

    // backend
    await Promise.all(R.map(testArgs => testOnlyAdminBackend(...testArgs),
        [ [ 'dAdd', [zeroHash, zeroAddr, false] ]
        ]))
}


const testPrefix = async ({svIx, owner, doLog, ensPR, tld, erc20, ixBackend}) => {
    const {democHash} = await mkDemoc({svIx, erc20, txOpts: {from: owner, value: 1}})

    const prefixHex = democHash.slice(2, 2 + 26)
    const prefixBase32 = hexToB32(prefixHex)

    assert.equal(await ixBackend.getDHash("0x" + prefixHex), democHash)
}


const testRevertCases = async ({svIx, accounts, owner, doLog, erc20, ixPayments, ixBackend, commBSimple}) => {
    const [,u1,u2,u3,u4] = accounts;
    await asyncAssertThrow(() => SVPayments.new(zeroAddr), "payments assert-throws on zeroAddr")

    const {democHash} = await mkDemoc({svIx, erc20, txOpts: {value: 1000}})

    await assertRevert(ixPayments.payForDemocracy(democHash, {value: 0}), 'zero payment should revert')
    await ixPayments.payForDemocracy(democHash, {value: oneEth})

    const [s,e] = await genStartEndTimes()
    await assertRevert(svIx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkPacked(s, e, USE_ETH | USE_NO_ENC | USE_TESTING)), 'should revert as testing ballots cant ixBackend deployed through index')
    await svIx.dDeployBallot(democHash, genRandomBytes32(), zeroHash,              mkPacked(s, e, USE_ETH | USE_NO_ENC))

    await ixBackend.dAdd(toHex("test democ sldkfjlskdjlsk"), erc20.address, false)
    await asyncAssertThrow(() => ixBackend.dAdd(toHex("test democ sldkfjlskdjlsk"), erc20.address, false), 'conflict of democHash prefix')

    // trigger commBSimple upgrade revert
    await commBSimple.upgradeMe(u2, {from: u1})
    await assertRevertF(() => commBSimple.upgradeMe(u3, {from : u1}), 'cant upgrade same acct twice')
    await assertRevertF(() => commBSimple.noteBallotDeployed("0x00", {from : u1}), 'reverted due to upgrade')
}


const testPremiumUpgradeDowngrade = async ({svIx, owner, doLog, erc20, ixPayments, ixBackend, accounts}) => {
    const premMultiplier = (await ixPayments.getPremiumMultiplier()).toNumber()
    const premPrice30Days = await ixPayments.getPremiumCentsPricePer30Days()
    const premWeiPer30Days = await ixPayments.centsToWei(premPrice30Days)
    const weiPerCent = await ixPayments.getWeiPerCent();
    const {democHash} = await mkDemoc({svIx, erc20, txOpts: {value: 1}})
    const b = await getBlock('latest')

    const [,u1,u2,u3,u4] = accounts;
    await svIx.setDEditor(democHash, u3, true)
    assert.equal(await ixBackend.isDEditor(democHash, u3), true, 'u3 should be editor')
    await assertRevert(svIx.dUpgradeToPremium(democHash, {from: u3}), 'u3 cannot perform an upgrade (editor)')

    // test upgrade and downgrade with no time
    assert.deepEqual(await ixPayments.getAccount(democHash), [false, toBigNumber(0), toBigNumber(0), false], 'getAccount matches init expectations')
    assert.equal(await ixPayments.getPremiumStatus(democHash), false, 'not premium 1')
    await svIx.dUpgradeToPremium(democHash)
    assert.deepEqual(await ixPayments.getAccount(democHash), [true, toBigNumber(0), toBigNumber(0), false], 'getAccount matches expectations after null upgrade')
    assert.equal(await ixPayments.getPremiumStatus(democHash), true, 'is premium 1')
    // we can downgrade freely if there are 0 seconds left
    await svIx.dDowngradeToBasic(democHash)
    assert.deepEqual(await ixPayments.getAccount(democHash), [false, toBigNumber(0), toBigNumber(0), false], 'getAccount matches expectations after null downgrade')
    assert.equal(await ixPayments.getPremiumStatus(democHash), false, 'not premium 2')

    assert.deepEqual(await ixPayments.getSecondsRemaining(democHash), toBigNumber(0), 'no seconds remaining')

    // now with payments
    const centsFor30Days = await ixPayments.getBasicCentsPricePer30Days();
    const weiFor30Days = await ixPayments.centsToWei(centsFor30Days);
    assert.deepEqual(await ixPayments.weiToCents(weiFor30Days), centsFor30Days, '30 days of wei matches cents expectation')
    await ixPayments.payForDemocracy(democHash, {value: weiFor30Days})
    const b2 = await getBlock('latest')
    assert.deepEqual(await ixPayments.getAccount(democHash), [false, toBigNumber(b2.timestamp), toBigNumber(b2.timestamp + 60 * 60 * 24 * 30), false], 'getAccount matches after payment')
    assert.reallyClose(await ixPayments.getSecondsRemaining(democHash), toBigNumber(60 * 60 * 24 * 30), 'should have 30 days left')

    // let's do that upgrade!
    await svIx.dUpgradeToPremium(democHash)
    await assertRevert(svIx.dUpgradeToPremium(democHash), 'cannot upgrade to premium twice')
    assert.deepEqual(await ixPayments.getAccount(democHash), [true, toBigNumber(b2.timestamp), toBigNumber(b2.timestamp + 60 * 60 * 24 * 30 / premMultiplier), false], 'getAccount matches after upgrade')
    assert.reallyClose(await ixPayments.getSecondsRemaining(democHash), toBigNumber(60 * 60 * 24 * 30 / premMultiplier), 'should have 6 days left')

    await ixPayments.payForDemocracy(democHash, {value: weiFor30Days})
    const b3 = await getBlock('latest')
    assert.deepEqual(await ixPayments.getAccount(democHash), [true, toBigNumber(b3.timestamp), toBigNumber(b2.timestamp + 2 * 60 * 60 * 24 * 30 / premMultiplier), false], 'getAccount matches after upgrade')
    assert.reallyClose(await ixPayments.getSecondsRemaining(democHash), toBigNumber(2 * 60 * 60 * 24 * 30 / premMultiplier), 'should have 12 days left')

    assert.deepEqual(premPrice30Days, centsFor30Days.times(premMultiplier), 'prices match according to premium multiplier')

    await ixPayments.payForDemocracy(democHash, {value: premWeiPer30Days})
    const b4 = await getBlock('latest')
    let timeLeft = ((2 + premMultiplier) * 60 * 60 * 24 * 30 / premMultiplier);
    assert.deepEqual(await ixPayments.getAccount(democHash), [true, toBigNumber(b4.timestamp), toBigNumber(b2.timestamp + timeLeft), false], 'getAccount matches after upgrade')
    assert.reallyClose(await ixPayments.getSecondsRemaining(democHash), toBigNumber(timeLeft), 'should have 42 days left')


    // and test downgrades
    await assertRevert(svIx.dDowngradeToBasic(democHash), 'should error on downgrade <24hrs after upgrade')
    const timeOffset = 60 * 60 * 24 + 10
    await increaseTime(timeOffset)  // move forward so we can downgrade
    timeLeft -= timeOffset
    await svIx.dDowngradeToBasic(democHash)
    timeLeft *= premMultiplier
    await assertRevert(svIx.dDowngradeToBasic(democHash), 'cant downgrade twice')
    const b5 = await getBlock('latest')

    // need to split this up b/c the downgrade can have an error of up to 5s due to rounding (which occurs in the _upgrade_ step)
    const [isPrem, lastPaid, paidTill] = await ixPayments.getAccount(democHash);
    assert.deepEqual([isPrem, lastPaid], [false, toBigNumber(b4.timestamp)], 'getAccount [0:1] matches after downgrade')
    assert.reallyClose(paidTill, toBigNumber(b5.timestamp + timeLeft), 'getAccount paidTill matches after downgrade', 6)
    assert.reallyClose(await ixPayments.getSecondsRemaining(democHash), toBigNumber(timeLeft), 'should have 42*5 days left', 6)

    // check payments log
    assert.deepEqual(await ixPayments.getPaymentLogN(), toBigNumber(4), 'payment n log as expected')
    assert.deepEqual(await ixPayments.getPaymentLog(0), [false, democHash, toBigNumber(0), toBigNumber(1)], 'payment 0 matches')
    assert.deepEqual(await ixPayments.getPaymentLog(1), [false, democHash, toBigNumber(60*60*24*30), weiFor30Days], 'payment 1 matches')
    assert.deepEqual(await ixPayments.getPaymentLog(2), [false, democHash, toBigNumber(60*60*24*30 / premMultiplier | 0), weiFor30Days], 'payment 2 matches')
    assert.deepEqual(await ixPayments.getPaymentLog(3), [false, democHash, toBigNumber(60*60*24*30), premWeiPer30Days], 'payment 3 matches')


    await ixPayments.giveTimeToDemoc(democHash, 100, "a reference")
    assert.deepEqual(await ixPayments.getPaymentLog(4), [true, democHash, toBigNumber(100), toBigNumber(0)], 'payment 3 matches')
}


const testPaymentsSettingValues = async ({svIx, owner, doLog, erc20, ixPayments, ixBackend, commBSimple}) => {
    const initWeiPerCent =   toBigNumber('16583747000000')
    const initCommBPrice = toBigNumber('1666666666000000')
    const initCentsPer30Days = toBigNumber(125000)
    const initBallotsPerMonth = toBigNumber(10)
    const initPremMult = toBigNumber(5)
    const initExchRate = toBigNumber(60300)
    const initCommBWeiPrice = initWeiPerCent.times(initCommBPrice)
    const initExtraBallotWei = initCentsPer30Days.div(initBallotsPerMonth).times(initWeiPerCent)

    // test initial values
    assert.deepEqual(await commBSimple.getNextPrice("0x00"), initCommBPrice, 'commb init wei price')
    assert.deepEqual(await ixPayments.getBasicCentsPricePer30Days(), initCentsPer30Days, 'basic 30 days cents price')
    assert.deepEqual(await ixPayments.getBasicExtraBallotFeeWei(), initExtraBallotWei, 'init extra ballot wei')
    assert.deepEqual(await ixPayments.getBasicBallotsPer30Days(), initBallotsPerMonth, 'init ballots / mo')
    assert.deepEqual(await ixPayments.getPremiumMultiplier(), initPremMult, 'init prem mult')
    assert.deepEqual(await ixPayments.getPremiumCentsPricePer30Days(), initCentsPer30Days.times(initPremMult), 'init prem cents / mo')
    assert.deepEqual(await ixPayments.getWeiPerCent(), initWeiPerCent, 'init wei per cent')
    assert.deepEqual(await ixPayments.getUsdEthExchangeRate(), initExchRate, 'init cents/eth')


    const newWeiPerCent = toBigNumber('58976170000000')
    const newExchRate = toBigNumber('16956')
    const newCommBPrice = toBigNumber('5000')
    const newCommBWei = newWeiPerCent.times(newCommBPrice)
    const newCentsPer30Days = toBigNumber('150000')
    const newBallotsPerMonth = toBigNumber('10')
    const newExtraBWei = newCentsPer30Days.div(newBallotsPerMonth).times(newWeiPerCent)
    const newPremMult = toBigNumber('3')
    const newPremCents = newCentsPer30Days.times(newPremMult)

    await ixPayments.setWeiPerCent(newWeiPerCent)
    await commBSimple.setPriceWei(newCommBWei)
    await ixPayments.setBasicCentsPricePer30Days(newCentsPer30Days)
    await ixPayments.setBasicBallotsPer30Days(newBallotsPerMonth)
    await ixPayments.setPremiumMultiplier(newPremMult)

    assert.deepEqual(await commBSimple.getNextPrice("0x00"), newCommBWei, 'commb new price')
    assert.deepEqual(await ixPayments.getBasicCentsPricePer30Days(), newCentsPer30Days, 'new basic 30 days cents price')
    assert.deepEqual(await ixPayments.getBasicExtraBallotFeeWei(), newExtraBWei, 'new extra ballot wei')
    assert.deepEqual(await ixPayments.getBasicBallotsPer30Days(), newBallotsPerMonth, 'new ballots / mo')
    assert.deepEqual(await ixPayments.getPremiumMultiplier(), newPremMult, 'new prem mult')
    assert.deepEqual(await ixPayments.getPremiumCentsPricePer30Days(), newPremCents, 'new prem cents / mo')
    assert.deepEqual(await ixPayments.getWeiPerCent(), newWeiPerCent, 'new wei per cent')
    assert.deepEqual(await ixPayments.getUsdEthExchangeRate(), newExchRate, 'new cents/eth')
}


const testPayoutAll = async ({svIx, ixPayments, owner, doLog, accounts, ixBackend, bbFarm}) => {
    const [, newPayTo, u2, u3, u4] = accounts;
    // assert.equal(await svIx.getPayTo(), owner, 'svIx should get their payTo from payments - should be owner by default')

    await ixPayments.setPayTo(newPayTo, {from: owner})

    const th = await TestHelper.new();

    await th.sendTransaction({value: oneEth, from: u4})

    const balPre = await getBalance(newPayTo);
    assert.deepEqual(await getBalance(th.address), oneEth, 'balance of test helper should ixBackend 1 ether')
    assert.equal(await getBalance(ixPayments.address), 0, 'ixPayments has no balance yet')
    await th.destroy(ixPayments.address)
    assert.deepEqual(await getBalance(ixPayments.address), oneEth, 'ixPayments should have 1 eth')
    await ixPayments.payoutAll()
    assert.equal(await getBalance(ixPayments.address), 0, 'ixPayments has sent balance away')
    assert.deepEqual(await getBalance(newPayTo), balPre.plus(oneEth), 'u1 now has one extra ether due to payoutAll')

    // shouldn't have used these above
    const [sender, payTo, u6] = accounts.slice(4);
    await doLog(`setup testPayTo with sender:${sender}, payTo:${payTo}, u6:${u6}`)
    const testPayTo = async (cToTest, name) => {
        // general way we test this is:
        //      (before this function) set up some contract to test
        //      selfdestruct at the contract to test (pointed at cToTest)
        //      get balance of payTo
        //      call cToTest.payoutAll()
        //      get balance of payTo again
        //      assert the difference
        await doLog(`Testing payoutAll for ${name}`)

        const c = await payoutAllTest.new(sender, {from: sender});
        const amt = oneEth.div(5);
        await c.sendTransaction({from: sender, value: amt})

        const balCPre = await getBalance(cToTest.address)
        await c.selfdestruct(cToTest.address)
        const balCPost = await getBalance(cToTest.address)

        assert.deepEqual(balCPre.plus(amt), balCPost, `Bal for cToTest ${name},${cToTest.address} post testHelper.selfdestruct match expectations (bal increases by ${amt.toFixed()}`)

        const balPTPre = await getBalance(payTo)
        const payoutAllTxr = await cToTest.payoutAll({from: u6})
        const balPTPost = await getBalance(payTo)

        assert.deepEqual(balPTPre.plus(amt), balPTPost, `Bal for payTo (${payTo}; testing ${name}) post payoutAll() match expectations (bal increases by ${amt.toFixed()}\nTxr:\n${toJson(payoutAllTxr)}`)

        await doLog(`Test payoutAll for ${name} okay`)
    }


    // index payto - note: index should pay to payments payTo
    // init payTo always set to msg.sender which is owner
    await ixPayments.setPayTo(payTo)
    await testPayTo(svIx, 'svIx')

    // test ixBackend - should pay to owner
    const ixBackendTest = await SVIxBackend.new({from: sender})
    assert.equal(await ixBackendTest.owner(), sender, 'ixBackend owner init')
    await ixBackendTest.setOwner(payTo, {from: sender})
    assert.equal(await ixBackendTest.owner(), payTo, 'ixBackend owner set correctly')
    await testPayTo(ixBackendTest, 'ixbackend')

    // test bbfarm - should pay owner
    const bbFarmTest = await BBFarm.new({from: sender})
    await bbFarmTest.setOwner(payTo, {from: sender})
    await testPayTo(bbFarmTest, 'bbfarm')
}


const testSponsorshipOfCommunityBallots = async ({svIx, erc20, accounts, owner, bbFarm, doLog, ixPayments, ixBackend, commBSimple}) => {
    const [, dAdmin, u2, u3, u4, u5] = accounts

    await doLog('creating democ')
    const {democHash} = await mkDemoc({svIx, erc20, txOpts: {from: dAdmin, value: 1}})
    const times = await genPackedTime();

    await doLog('getting commb price and verifiying ballotsN === 0')
    const commBPriceEth = await commBSimple.getNextPrice("0x00");

    assert.equal(await ixBackend.getDBallotsN(democHash), 0, 'no ballots yet')

    await doLog('deploying commb')
    const commBTxr = await svIx.dDeployCommunityBallot(democHash, genRandomBytes32(), zeroHash, times, {from: u2, value: commBPriceEth})
    const {args: {ballotId}} = getEventFromTxR("BallotCreatedWithID", commBTxr)
    await doLog(`got commb deployed with ballotId: ${ballotId} (txr: \n${toJson(commBTxr)})`)

    assert.equal(await ixBackend.getDBallotsN(democHash), 1, 'one ballot so far')

    const ballotIdCmp = await ixBackend.getDBallotID(democHash, 0);
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
    assert.equal(2, await svIx.getVersion(), "expect version to ixBackend 2");
}


const testNFPTierAndPayments = async ({svIx, erc20, owner, accounts, doLog, ixPayments, ixBackend}) => {
    // test that we can give and remove time on NFP accounts

    const [, democAdmin, u2, u3, u4, u5] = accounts;

    const {democHash} = await mkDemoc({svIx, erc20, txOpts: {value: 1, from: democAdmin}})

    assert.equal(await ixPayments.getDenyPremium(democHash), false, 'should not have denyPremium yet')

    await ixPayments.setDenyPremium(democHash, true, {from: owner})
    assert.equal(await ixPayments.getDenyPremium(democHash), true, 'should have denyPremium now')

    await assertRevert(ixPayments.setDenyPremium(democHash, false, {from: democAdmin}), 'bad acct cant do setDenyPremium')
    await assertRevert(ixPayments.giveTimeToDemoc(democHash, 100, zeroHash, {from: democAdmin}), 'bad acct cant do giveTimeToDemoc')

    await ixPayments.giveTimeToDemoc(democHash, 60 * 60 * 24 * 30 * 2, toHex("nfp - test 1....."))

    await assertRevert(ixPayments.giveTimeToDemoc(democHash, 100, zeroHash, {from: u5}), 'u5 cant yet do giveTimeToDemoc')
    await ixPayments.setMinorEditsAddr(u5);
    await ixPayments.giveTimeToDemoc(democHash, 100, toHex("nfp - test 2....."), {from: u5})

    await assertRevert(svIx.dUpgradeToPremium(democHash, {from: democAdmin}), "can't upgrade to premium because we've set denyPremium=true")
}


const testBasicExtraBallots = async ({svIx, owner, doLog, erc20, ixPayments, accounts, ixBackend, bbFarm}) => {
    const [, u1, u2, u3, u4] = accounts;

    const {democHash, dOwner} = await mkDemoc({svIx, erc20, txOpts: {value: oneEth.times(5)}})

    let _aBallotsCountedCalledN = 0;
    const assertBallotsCounted = async (n) => {
        _aBallotsCountedCalledN++;
        assert.equal((await ixBackend.getDCountedBasicBallotsN(democHash)).toNumber(), n, `ballots counted should ixBackend == ${n} (note: this is the ${_aBallotsCountedCalledN}th call to this assert)`)
    }
    await assertBallotsCounted(0)

    const nBallotsPerMonth = (await ixPayments.getBasicBallotsPer30Days()).toNumber()
    const extraBallotPrice = await ixPayments.getBasicExtraBallotFeeWei()

    const mkBallot = async (txOpts) => {
        const [s, e] = await genStartEndTimes()
        return await svIx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkPacked(s, e, USE_ETH | USE_ENC | IS_OFFICIAL | IS_BINDING), txOpts || {})
    }

    const {timestamp: firstBallotTs} = await getBlock('latest')
    // fill up our monthly quota
    for (let i = 0; i < nBallotsPerMonth; i++) {
        await assertBallotsCounted(i)
        await mkBallot()
    }
    await assertBallotsCounted(nBallotsPerMonth)

    // test this before anything else to make sure we're really limited
    await assertRevert(mkBallot(), `should not ixBackend able to make more than ${nBallotsPerMonth} official ballots per month for free`)

    await svIx.dUpgradeToPremium(democHash)
    // can now add another ballot because we're premium
    await mkBallot()
    await assertBallotsCounted(nBallotsPerMonth)
    await increaseTime(60 * 60 * 24 + 10)  // move forward a bit more than a day
    await svIx.dDowngradeToBasic(democHash)

    const {timestamp: s} = await getBlock('latest')
    const e = s + 600

    await doLog("About to test reverts on multiple deploy ballots - expected to revert due to basicBallotLimit")

    await assertRevert(mkBallot(), `still can't make more than ${nBallotsPerMonth} official ballots per month for free`)
    await assertRevert(svIx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkPacked(s, e, USE_ETH | USE_ENC)), 'b w enc')
    await assertRevert(svIx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkPacked(s, e, USE_ETH | USE_NO_ENC | IS_OFFICIAL)), 'b w official')
    await assertRevert(svIx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkPacked(s, e, USE_ETH | USE_NO_ENC | IS_BINDING)), 'b w binding')
    // this is okay as it qualifies as a community ballot
    await doLog("About to test deploying a community ballot - should be okay b/c community ballots are enabled. this is before we test paying for extra basic ballots")
    await svIx.dDeployCommunityBallot(democHash, genRandomBytes32(), zeroHash, mkPackedTime(s, e), {value: oneEth})
    await assertBallotsCounted(nBallotsPerMonth)

    await assertRevert(mkBallot({value: extraBallotPrice.minus(1)}), 'required to pay >= fee')
    // this works though

    // need to do this to make sure we're not sending the money back to ourselves
    // derp
    await ixPayments.setPayTo(u4);

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
    await doLog(`testing ballot that should ixBackend in the new month.
        Started  ${firstBallotTs}
        Now is   ${bEnd.timestamp}
        diff as month proportion: ${(bEnd.timestamp - firstBallotTs) / 30 / 24 / 60 / 60}`)
    const ballotsCounted = (await ixBackend.getDCountedBasicBallotsN(democHash)).toNumber()
    await doLog(`Counted ballots: ${ballotsCounted} (and nBallots: ${nBallotsPerMonth}`)
    const earlyBallotIdResp = await ixBackend.getDCountedBasicBallotID(democHash, ballotsCounted - nBallotsPerMonth)
    await doLog(`earlyBallotId Raw: ${toJson(earlyBallotIdResp)}`)
    const earlyBallotId = earlyBallotIdResp.toNumber()
    await doLog(`earlyBallotId: ${earlyBallotId}`)
    await doLog(`earlyBallotTs: ${await bbFarm.getCreationTs(earlyBallotId)}`)
    const secsLeft = (await ixPayments.getSecondsRemaining(democHash)).toNumber()
    await doLog(`seconds left on democ: ${secsLeft}`)

    await mkBallot()

    // also ensure that if we try to make a ballot with an end time too far in the future - it fails
    const [s2] = await genStartEndTimes()
    await assertRevert(svIx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkPacked(s2, s2 + (2 * secsLeft) + 100, USE_ETH | USE_NO_ENC | IS_BINDING)), 'cannot create ballot with end time > 2x the seconds remaining')
    await svIx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, mkPacked(s2, s2 + (2 * secsLeft) - 100, USE_ETH | USE_NO_ENC | IS_BINDING))
}


const testEmergencyMethods = async ({svIx, accounts, owner, bbFarm, erc20, doLog, ixBackend, ixPayments, ixEnsPx, commBSimple}) => {
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
    const {democHash, dOwner} = await mkDemoc({svIx, erc20, txOpts: {from: democAdmin, value: 1}})
    await doLog(`democ created.`)

    assert.equal(await ixBackend.getDOwner(democHash), democAdmin, "d admin should match")

    await doLog(`running emergencySetDAdmin`)
    await svIx.emergencySetDOwner(democHash, setTo)
    assert.equal(await ixBackend.getDOwner(democHash), setTo, "d admin should match after emergency")

    await assertRevert(svIx.emergencySetDOwner(democHash, badActor, {from: badActor}), 'cannot emergency set admin for democ from bad acct')

    /* Other emergency methods */

    await doLog(`done. about to test init conditions for emergency methods`)

    await testAddr('getBackend', ixBackend.address)
    await testAddr('getPayments', ixPayments.address)
    await testAddr('getBBFarm', bbFarm.address, 0)
    await testAddr('getCommAuction', commBSimple.address)

    await doLog(`init conditions validated. testing emergency set methods`)

    await assertRevert(svIx.setABackend("nonexistent", setTo), 'setABackend should revert with nonexistent backend label')
    await svIx.setABackend("payments", setTo)
    await svIx.setABackend("backend", setTo)
    await svIx.setABackend("commAuction", setTo)
    hasSetEmergency = true;  // side effect in testAddr

    await doLog(`emergency set methods tested. testing setting from bad addrs`)

    await testBadAddr('setABackend', "payments")
    await testBadAddr('setABackend', "backend")
    await testBadAddr('setABackend', "commAuction")

    await doLog(`setting from bad addrs tested. validating results`)

    await testAddr('getBackend', setTo)
    await testAddr('getPayments', setTo)
    await testAddr('getCommAuction', setTo)

    await doLog(`results validated.`)

    await doLog(`done`)
}


const testOwnerAddBallot  = async ({svIx, accounts, owner, erc20, doLog, ixBackend}) => {
    const [, dAdmin, u2, u3, u4] = accounts;

    const {democHash} = await mkDemoc({svIx, erc20, txOpts: {from: dAdmin, value: oneEth}})

    await assertRevert(svIx.dDeployBallot(democHash, genRandomBytes32(), zeroAddr, await mkStdPacked(), {from: owner}), 'svIx owner cant call dDeployBallot')
    // democ admin can deploy
    await svIx.dDeployBallot(democHash, genRandomBytes32(), zeroAddr, await mkStdPacked(), {from: dAdmin})

    await svIx.dAddBallot(democHash, 666, await mkStdPacked(), {from: owner})
    await assertRevert(svIx.dAddBallot(democHash, 666, await mkStdPacked(), {from: dAdmin}), 'democAdmin cant call dAddBallot')
}


const testGrantingSelfTime = async ({svIx, accounts, owner, erc20, doLog, ixBackend, ixPayments}) => {
    const [, u1, u2, u3, u4] = accounts;
    const {democHash} = await mkDemoc({svIx, erc20, txOpts: {from: u2, value: 1}})

    await assertRevert(ixPayments.doFreeExtension(democHash), 'cannot grant self time yet')
    assert.deepEqual(await ixPayments.getSecondsRemaining(democHash), toBigNumber(0), 'no time atm')

    const sec1 = 60 * 60 * 24 * 20;
    await ixPayments.giveTimeToDemoc(democHash, sec1, "0x00")
    assert.reallyClose(await ixPayments.getSecondsRemaining(democHash), toBigNumber(sec1), `has ${sec1} seconds`)

    const days60 = 60 * 60 * 24 * 60;
    assert.equal(await ixPayments.getFreeExtension(democHash), false, 'no free ext yet')
    await ixPayments.setFreeExtension(democHash, true)
    assert.equal(await ixPayments.getFreeExtension(democHash), true, 'has free ext now')

    await ixPayments.doFreeExtension(democHash, {from: u2})
    assert.reallyClose(await ixPayments.getSecondsRemaining(democHash), toBigNumber(days60), `has 60 days secs now`)
}


const testAddingBBFarm = async({svIx, owner, erc20, ixBackend, ixPayments, doLog, accounts}) => {
    const [, u1, u2, u3] = accounts;
    const farmTesting2 = await BBFarmTesting.new("0x00000000")
    const farmCopy = await BBFarmTesting.new("0x00000001")
    const farmTesting = await BBFarmTesting.new("0x00000002")

    await assertRevert(svIx.addBBFarm(farmCopy.address, {from: owner}), 'reverts bc the namespace is taken')
    await assertRevert(svIx.addBBFarm(farmTesting2.address, {from: owner}), 'reverts bc the namespace is 0')
    await assertRevert(svIx.addBBFarm(farmTesting.address, {from: u1}), 'reverts bc sender is bad')
    await svIx.addBBFarm(farmTesting.address, {from: owner})  // works

    for (var i = 2; i < 260; i++){
        var ns = genRandomBytes(4)
        var newFarm = await BBFarmTesting.new(ns)
        await doLog(`Deploying bbfarm ${i} and ns ${ns}`)
        if (i >= 2**8) {
            await assertRevert(svIx.addBBFarm(newFarm.address, {from: owner}), `reverts as bbfarm id would ixBackend ${i} (>= 256)`)
        } else {
            await svIx.addBBFarm(newFarm.address, {from: owner})
        }
    }
}


const testDeprecateBBFarm = async ({doLog, svIx, bbFarm, ixBackend, ixPayments, erc20, owner, accounts: [, u1,u2,u3,u4]}) => {
    await assertRevert(svIx.deprecateBBFarm(0, bbFarm.address, {from: u1}), 'fail deprecate bbfarm - bad user')
    await assertRevert(svIx.deprecateBBFarm(0, u1, {from: owner}), 'fail dep bbfarm - bad bbfarm address')
    await assertRevert(svIx.deprecateBBFarm(1, zeroAddr, {from: owner}), 'fail dep bbfarm - zero addr (i.e. bbFarm 1 hasnt been created yet - lookup would give addr of 0)')
    await svIx.deprecateBBFarm(0, bbFarm.address, {from: owner})

    const {democHash, dOwner} = await mkDemoc({svIx, erc20, txOpts: {value: oneEth, from: owner}})
    await assertRevert(svIx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, await mkStdPacked(), {from: owner}), 'bb deprecated - ballot for bbfarm[0] doesnt work')

    const bbf2 = await BBFarmTesting.new("0x00001337")
    await svIx.addBBFarm(bbf2.address, {from: owner})
    // this works now because we're using the second bbfarm via the first byte of extraData
    await svIx.dDeployBallot(democHash, genRandomBytes32(), "0x01" + genRandomBytes(31).slice(2), await mkStdPacked(), {from: owner})
    assert.deepEqual(await svIx.getBBFarmID('0x00001337'), toBigNumber(1), 'namespace lookup works')
}


const testRefundIfAccidentalValueTfer = async ({doLog, svIx, ixBackend, ixPayments, erc20, owner, accounts: [,u1,u2,u3,u4]}) => {
    const {democHash, dOwner} = await mkDemoc({svIx, erc20, txOpts: {value: oneEth, from: u1}})

    assert.equal(await ixPayments.accountInGoodStanding(democHash), true, 'account is in good stnaidng')

    const b1 = await getBalance(dOwner);
    await svIx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, await mkStdPacked(), {value: oneEth, gasPrice: 0, from: dOwner})
    const b2 = await getBalance(dOwner)

    assert.deepEqual(b1, b2, 'balance should not decrease if user accidentally sends funds to dDeployBallot');
}


const testArbitraryData = async ({svIx, owner, ixBackend, erc20, accounts: [, u1, u2]}) => {
    const {democHash} = await mkDemoc({svIx, erc20, txOpts: {value: 1, from: u1}})

    // note - the dSetArbitraryData method will first check if you're an owner, and if so store it normally
    // if you're not, it'll check if you're an editor, and set it using dSetEditorArbitraryData on backend
    // the difference is that the key for dSetArbData is keccak256(key), and for an editor it is
    // keccak256(abi.encodePacked("editor.", key))

    await svIx.dSetArbitraryData(democHash, "0x0123", "0x01c8", {from: u1});
    assert.equal(await ixBackend.getDArbitraryData(democHash, "0x0123"), "0x01c8", 'arb data matches')
    await assertRevert(svIx.dSetArbitraryData(democHash, "0x0123", "0x1111", {from: u2}), 'reverts bad sender')

    await svIx.setDEditor(democHash, u2, true, {from: u1});
    await svIx.dSetArbitraryData(democHash, "0x0123", "0x2222", {from: u2})  // u2 okay now
    /// HOWEVER
    assert.equal(await ixBackend.getDArbitraryData(democHash, "0x0123"), "0x01c8", 'arb data matches original tx, not u2')
    assert.equal(await ixBackend.getDEditorArbitraryData(democHash, "0x0123"), "0x2222", 'arb data matches original tx, not u2')
}


const testReclaimToken = async ({svIx, owner, erc20, doLog, ixPayments}) => {
    assert.deepEqual(await erc20.balanceOf(owner), toBigNumber(0), 'token balance owner 0 init')
    assert.deepEqual(await erc20.balanceOf(svIx.address), toBigNumber(0), 'token balance ix 0 init')
    await erc20.faucet({from: owner});
    const tokenBalance = await erc20.balanceOf(owner);
    await doLog(`Token balance is ${tokenBalance.toFixed()}`)

    // transfer tokens to index
    await erc20.transfer(svIx.address, tokenBalance)
    assert.deepEqual(await erc20.balanceOf(owner), toBigNumber(0), 'token balance owner 0 after tfer')
    assert.deepEqual(await erc20.balanceOf(svIx.address), tokenBalance, `token balance ix ${tokenBalance.toFixed()} after tfer`)

    await svIx.relcaimToken(erc20.address);
    await erc20.transferFrom(svIx.address, owner, tokenBalance);
    assert.deepEqual(await erc20.balanceOf(owner), tokenBalance, `token balance ix ${tokenBalance.toFixed()} after reclaim`)
    assert.deepEqual(await erc20.balanceOf(svIx.address), toBigNumber(0), `token balance ix 0 after reclaim`)
}


/* bb farm won - by a lot
    Std:  1392871
    Lib:  1310372
    NoSC: 155579
    BBFarm: 274586
*/
const testGasOfBallots = async ({svIx, owner, erc20, ixBackend}) => {
    const {democHash, dOwner} = await mkDemoc({svIx, txOpts: {from: owner, value: oneEth}, erc20});
    const packed = toBigNumber(await mkStdPacked());

    // deploy a ballot to start with to make sure anything needed to ixBackend set is set
    const b0 = await getBalance(owner)

    await svIx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, packed, {gasPrice: 1})

    const b1 = await getBalance(owner)

    await svIx.dDeployBallot(democHash, genRandomBytes32(), zeroHash, packed, {gasPrice: 1})

    const b2 = await getBalance(owner)

    await svIx.dDeployCommunityBallot(democHash, genRandomBytes32(), zeroHash, mkPackedTime(...(await genStartEndTimes())), {value: oneEth, gasPrice: 1})

    // since owner is the payTo we don't have a net transfer of money - only eth used is gas!
    const b3 = await getBalance(owner)

    await mkDemoc({svIx, txOpts: {value: 1, gasPrice: 1}, erc20});

    const b4 = await getBalance(owner);

    console.log(`
    Deploy Ballot Gas Costs:
    BBF1st: ${b0.minus(b1).toFixed()}
    BBFarm: ${b1.minus(b2).toFixed()}
    CommB:  ${b2.minus(b3).toFixed()}

    Init Democ Gas Cost:
    ${b3.minus(b4).toFixed()}
    `)
}


contract("SVLightIndex", function (accounts) {
    const skipOnEnvVar = (testStr, testF, envVarStr) => {
        const eVar = process.env[envVarStr]
        const allT = process.env.RUN_ALL_TESTS
        const condAll = (allT && allT.toLowerCase() === "true")
        const cond = (eVar && eVar.toLowerCase() === "true") || condAll
        console.log(`Test (${testStr}) will be skipped if the following env var is present:\n${envVarStr}=true`)
        console.log(cond ? "running this time" : "skipping this time")
        const defaultF = async () => { return true; }
        return [testStr, cond ? testF : defaultF]
    }

    tests = [
        // ["test instantiation", testInit],
        // ["test gas ballots", testGasOfBallots],
        // ["test payments setting values", testPaymentsSettingValues],
        // ["test granting self time", testGrantingSelfTime],
        // ["test deprecation of bbfarms", testDeprecateBBFarm],
        // ["test refund on accidental tfer to paybale methods", testRefundIfAccidentalValueTfer],
        // ["test nfp tier", testNFPTierAndPayments],
        // ["test owner add ballot", testOwnerAddBallot],
        // ["test paying for extra ballots (basic)", testBasicExtraBallots],
        // ["test revert cases", testRevertCases],
        // ["test premium upgrade and downgrade", testPremiumUpgradeDowngrade],
        // ["test payout all", testPayoutAll],
        // ["test arbitrary data", testArbitraryData],
        // ["test democ prefix stuff", testPrefix],
        // ["test all admin functions and categories (crud)", testAllAdminFunctionsAndCategories],
        // ["test currency conversion", testCurrencyConversion],
        // ["test payments backup admin", testPaymentsEmergencySetOwner],
        // ["test sponsorship of community ballots", testSponsorshipOfCommunityBallots],
        // ["test emergency methods", testEmergencyMethods],
        // ["test community ballots (default)", testCommunityBallots],
        // ["test version", testVersion],
        // ["test upgrade", testUpgrade],
        // ["test creating democ and permissions", testCreateDemoc],
        // ["test payments for democ", testPaymentsForDemoc],
        ["test reclaiming tokens", testReclaimToken],
        skipOnEnvVar("test adding BBFarm", testAddingBBFarm, "TEST_ADD_BBFARMS"),

    ];
    S.map(([desc, f]) => it(desc, wrapTestIx({accounts}, f)), tests);
});
