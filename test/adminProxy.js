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

const R = require('ramda')

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

        const dInitTxR = await svIx.dInit(erc20.address, {from: owner, value: 1});
        const [democHash, adminPxAddr] = getEventFromTxR("DemocAdded", dInitTxR)
        const adminPx = SVAdminPx.at(adminPxAddr)
        const ixPx = SVIndex.at(adminPxAddr)

        return await f({svIx, democHash, adminPx, ixPx, ensRry, ensRrr, ensPR, ensPx, be, pxF, bbF, tld, paySC, scLog, owner, backupOwner, ixEnsPx, erc20, accounts});
    };
};


const testAdminPxInit = async ({accounts, owner, svIx, democHash, adminPx, ixPx}) => {
}




contract("SVLightAdminProxy", function (accounts) {
    tests = [
        ["test admin px init", testAdminPxInit],
    ];
    R.map(([desc, f]) => it(desc, wrapTest({accounts}, f)), tests);
});
