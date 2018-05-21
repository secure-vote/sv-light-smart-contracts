const EnsPx = artifacts.require("./SvEnsEverythingPx");
const EnsPR = artifacts.require("./PublicResolver");
const EnsRegistrar = artifacts.require("./SvEnsRegistrar");
const EnsRegistry = artifacts.require("./SvEnsRegistry");
const EnsOwnerPx = artifacts.require("./EnsOwnerProxy");
const EmitterTesting = artifacts.require("./EmitterTesting");

const nh = require('eth-ens-namehash');

require("./testUtils")();

const R = require('ramda')


/**
 *  Convenience functions re ens domains and hash parts
 * @param {string} label
 *  the label as a string, e.g. 'blah123' in 'blah123.eth'
 * @param {string} tld
 *  the tld (or a full subdomain, e.g. 'eth' or 'mydomain.eth')
 * @returns {[string, string, string, string]}
 *  returns tuple of (labelHash, nodeHash, label, fullDomain)
 */
const ensHashParts = (label, tld) => {
    const fullDomain = label + "." + tld
    const node = nh.hash(fullDomain)
    const labelHash = web3.sha3(label)
    return [labelHash, node, label, fullDomain]
}


const wrapTest = ({accounts}, f) => {
    return async () => {
        const owner = accounts[0];

        const scLog = await EmitterTesting.new();

        // use this doLog function in the wrapper to easily turn on and off this logging
        // just in this initialization function
        const loggingActive = false;
        const doLog = async msg => {
            if (loggingActive)
                return await scLog.log(msg);
        }

        await doLog(`Created logger...`);

        const tld = "test";
        const tldLH = web3.sha3(tld);
        const tldNH = nh.hash(tld);

        const ensRry = await EnsRegistry.new();
        const ensRrr = await EnsRegistrar.new(ensRry.address, tldNH);
        await ensRry.setSubnodeOwner("0x0", tldLH, ensRrr.address);
        const ensPR = await EnsPR.new(ensRry.address);

        const ensPx = await EnsPx.new(ensRrr.address, ensRry.address, ensPR.address, tldNH)
        await ensRrr.addAdmin(ensPx.address);

        await doLog(`Created ensPx for tld: ${tld}`)

        return await f({ensRry, ensRrr, ensPR, ensPx, tld, tldLH, tldNH, scLog, owner, accounts}, accounts);
    };
};


const testTemplate = async ({ensRry, ensRrr, ensPR, ensPx, tld, tldLH, tldNH, scLog, owner, accounts}) => {
    const [_, u1, u2, u3, u4, u5] = accounts;
}


const testEnsPxInit = async ({ensRry, ensRrr, ensPR, ensPx, tld, tldLH, tldNH, scLog, owner, accounts}) => {
    assert.equal(await ensPx.owner(), owner, "owner matches")
    assert.equal(await ensPx.isAdmin(owner), true, "owner is admin")
    assert.equal(await ensPx.getAdminLogN(), 1, "only 1 admin in log thus far")
    assert.equal(await ensPx.getAdminLog(0), owner, "adminLog[0] is owner")
    assert.equal(await ensPx.registrar(), ensRrr.address, "registrar matches")
    assert.equal(await ensPx.registry(), ensRry.address, "registry matches")
    assert.equal(await ensPx.resolver(), ensPR.address, "resolver matches")
    assert.equal(await ensPx.rootNode(), tldNH, "rootNode matches")
}


const testEnsPxPermissions = async ({ensRry, ensRrr, ensPR, ensPx, tld, tldLH, tldNH, scLog, owner, accounts}) => {
    const [_, u1, u2, u3, u4, u5] = accounts;

    await assertRevert(ensPx.upgradeMeAdmin(u1, {from: owner}), 'owner cannot upgrade self')

    await ensPx.setAdmin(u1, true)
    await assertRevert(ensPx.setAdmin(owner, false, {from: u1}), 'owner cannot be removed as admin')
    await assertRevert(ensPx.setAdmin(u1, false, {from: u1}), 'cannot remove self as admin')

    await ensPx.setOwner(u1);
    await ensPx.setAdmin(owner, false, {from: u1})

    await assertRevert(ensPx.setAdmin(u2, true, {from: u3}), 'permissions required ot alter admin')
}


const testRegisterName = async ({ensRry, ensRrr, ensPR, ensPx, tld, tldLH, tldNH, scLog, owner, accounts}) => {
    const [_, u1, u2, u3, u4, u5] = accounts;

    const [d1LH, d1NH, d1Label, d1Full] = ensHashParts("domain1", tld);
    await ensPx.regName(d1Label, u5)
    assert.equal(await ensPR.addr(d1NH), u5, 'addr lookup matches (u5)')
    assert.equal(await ensRry.owner(d1NH), owner, 'owner is as sender on regName')

    const [d2LH, d2NH, d2Label, d2Full] = ensHashParts("domain2", tld)
    await ensPx.regNameWOwner(d2Label, u2, u4)
    assert.equal(await ensPR.addr(d2NH), u2, 'addr lookup matches (u2)')
    assert.equal(await ensRry.owner(d2NH), u4, 'owner of domain2 (u4) is set correctly using regNameWOwner')
}


contract("SvEnsEverythingPx", function (accounts) {
    tests = [
        ["test ens px init", testEnsPxInit],
        ["test ens px permissions", testEnsPxPermissions],
        ["test ens px rego", testRegisterName],
    ];
    R.map(([desc, f]) => it(desc, wrapTest({accounts}, f)), tests);
});
