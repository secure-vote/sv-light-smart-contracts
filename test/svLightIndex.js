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
        const loggingActive = false;
        const doLog = async msg => {
            if (loggingActive)
                return await scLog.log(msg);
        }

        await doLog(`Created logger...`);

        const be = await IxBackend.new();
        await doLog(`Created backend...`);
        const paySC = await IxPayments.new(backupOwner);
        await doLog(`Created payments backend...`);
        const pxF = await PxFactory.new();
        await doLog(`Created PxFactory...`);
        const bbF = await BBFactory.new();
        await doLog(`Created BBFactory...`);

        await doLog(`Set up contracts: \nbackend (${be.address}), \npaymentSettings (${paySC.address}), \npxFactory (${pxF.address}), \nbbFactory (${bbF.address})`)

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

        const svIx = await SVIndex.new(be.address, paySC.address, pxF.address, bbF.address, ensPx.address, ixEnsPx.address, {gasPrice: 0});
        await doLog(`Created svIx at ${svIx.address}`)

        await ixEnsPx.setAddr(svIx.address);
        await ixEnsPx.setAdmin(svIx.address, true);
        const ixEnsResolution = await ensPR.addr(indexNH);
        await doLog(`index.${tld} now resolves to ${ixEnsResolution}`)
        assert.equal(ixEnsResolution, svIx.address, "ixEns should resolve to ix")

        await be.setPermissions(svIx.address, true);
        await be.doLockdown();

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

        return await f({svIx, ensRry, ensRrr, ensPR, ensPx, be, pxF, bbF, tld, paySC, scLog, owner, backupOwner, ixEnsPx, erc20, accounts}, accounts);
    };
};


/* UTILITY FUNCTIONS */

const mkDemoc = async ({svIx, txOpts, erc20}) => {
    const createTx = await svIx.dInit(erc20.address, txOpts);
    const {args: {democHash, admin: pxAddr}} = getEventFromTxR("DemocAdded", createTx);
    const adminPx = SVAdminPx.at(pxAddr);

    return {democHash, adminPx};
}


/* ACTUAL TESTS */

const testUpgrade = async ({svIx, ensPx, paySC, be, ixEnsPx, pxF, bbF, owner, erc20}) => {
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
    const newIx = await SVIndex.new(be.address, paySC.address, pxF.address, bbF.address, ensPx.address, ixEnsPx.address);

    await svIx.doUpgrade(newIx.address);

    await assertRevert(svIx.doUpgrade(zeroAddr), "upgrade cannot be performed twice");

    assert.equal(await be.hasPermissions(newIx.address), true, "new ix should have BE permissions");
    assert.equal(await paySC.hasPermissions(newIx.address), true, "new ix should have payments permissions");
    assert.equal(await ensPx.isAdmin(newIx.address), true, "new ix should have ensPx permissions");
    assert.equal(await ixEnsPx.isAdmin(newIx.address), true, "new ix should have ixEnsPx permissions");

    assert.equal(await be.hasPermissions(svIx.address), false, "old ix should not have BE permissions");
    assert.equal(await paySC.hasPermissions(svIx.address), false, "old ix should not have payments permissions");
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


const testSVDemocCreation = async () => {
    // this tests the ability for SecureVote to create democs without payment

    throw Error('not implemented');
}


const testDemocAdminPermissions = async () => {
    throw Error('not implemented');

}


const testCommunityBallots = async ({accounts, owner, svIx, erc20}) => {
    // test in cases we have a community instance and in cases where
    // they're enabled on a paying democ

    // todo: ensure we're setting the right submission bits on the ballot
    // when doing community ballots. (i.e. IS_OFFICIAL and IS_BINDING both false)

    const {args: {democHash, admin}} = getEventFromTxR("DemocAdded", await svIx.dInit(erc20.address, {value: 1}))
    const adminPx = SVAdminPx.at(admin);
    const ixPx = SVIndex.at(admin);

    assert.equal(await adminPx.communityBallotsEnabled(), true, "comm ballots on by default")

    const [s,e] = genStartEndTimes()
    const packed = mkPacked(s, e, USE_ETH | USE_NO_ENC)
    adminPx.deployCommunityBallot(genRandomBytes32(), zeroHash, packed)
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


const testCommunityBallotsAllowedSubBits = async () => {
    throw Error('not implemented')
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


const testIxEnsSelfManagement = async () => {
    // test we can set and upgrade ENS via upgrades and permissions work out
    throw Error("not implemented");
}


const testNFPTierAndPayments = async () => {
    // test that we can give and remove time on NFP accounts
    throw Error("not implemented");
}


const testPaymentsBackupAdmin = async () => {
    // test the emergency backup admin address in payments
    throw Error("not implemented")
}


const testBasicExtraBallots = async () => {
    throw Error("not impl")
}


contract("SVLightIndex", function (accounts) {
    tests = [
        ["test upgrade", testUpgrade],
        ["test instantiation", testInit],
        ["test creating democ", testCreateDemoc],
        ["test payments for democ", testPaymentsForDemoc],
        // ["test SV democ creation", testSVDemocCreation],
        // ["test democ admin permissions", testDemocAdminPermissions],
        ["test community ballots (default)", testCommunityBallots],
        // ["test community ballots (nonpayment)", testCommunityBallotsNonPayment],
        // ["test deny community ballots", testNoCommunityBallots],
        // ["test allowed submission bits on comm ballots", testCommunityBallotsAllowedSubBits],
        // ["test sponsorship of community ballots", testSponsorshipOfCommunityBallots],
        // ["test currency conversion", testCurrencyConversion],
        // ["test premium upgrade and downgrade", testPremiumUpgradeDowngrade],
        // ["test paying for extra ballots (basic)", testBasicExtraBallots],
        // ["test catagories (crud)", testCatagoriesCrud],
        // ["test setting payment + backend", testSetBackends],
        // ["test version", testVersion],
        // ["test index ens self-management", testIxEnsSelfManagement],
        // ["test nfp tier", testNFPTierAndPayments],
        // ["test payments backup admin", testPaymentsBackupAdmin],
    ];
    S.map(([desc, f]) => it(desc, wrapTestIx({accounts}, f)), tests);
});
