const EnsPx = artifacts.require("./SvEnsEverythingPx");
const EnsPR = artifacts.require("./PublicResolver");
const EnsRegistrar = artifacts.require("./SvEnsRegistrar");
const EnsRegistry = artifacts.require("./SvEnsRegistry");
const EnsOwnerPx = artifacts.require("./EnsOwnerProxy");
const EmitterTesting = artifacts.require("./EmitterTesting");

const nh = require('eth-ens-namehash');

require("./testUtils")();

const R = require('ramda')

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

        return await f({ensRry, ensRrr, ensPR, ensPx, tld, scLog, owner, ixEnsPx, accounts, indexNH, indexLH}, accounts);
    };
};


const testEnsOwnerInit = async ({accounts, owner, ixEnsPx, ensPR, ensRry, indexNH}) => {
    assert.equal(await ixEnsPx.ensNode(), indexNH, "node for ensOwnerPx as expected")
    assert.equal(await ixEnsPx.ens(), ensRry.address, "ens registry is as expected")
    assert.equal(await ixEnsPx.resolver(), ensPR.address, "resolver is as expected")

    assert.equal(await ixEnsPx.isAdmin(owner), true, "owner is an admin on instantiation")

    const resTo = accounts[2];
    await ixEnsPx.setAddr(resTo);

    assert.equal(await ensPR.addr(indexNH), resTo, "we can setAddr as expected")
}


const testReturnToOwner = async ({accounts, ixEnsPx, ensPR, ensRry, indexNH}) => {
    assert.equal(await ensPR.addr(indexNH), zeroAddr, "ens resolution set to zeroAddr")
    assert.equal(await ensRry.owner(indexNH), ixEnsPx.address, "indexNH owner is ixEnsPx")

    const origOwner = await ixEnsPx.owner();
    await ixEnsPx.returnToOwner()
    assert.equal(await ensRry.owner(indexNH), origOwner, "returning to owner works")

    assertRevert(ixEnsPx.returnToOwner({from: accounts[1]}), "should revert on bad sender (admin returnToOwner)")
}


const testFwdToEns = async ({accounts, ixEnsPx, ensPR, ensRrr, ensRry, indexNH}) => {
    const ensDataSetTTL = getData(ensRry.setTTL, indexNH, 1337);
    const ensDataSetOwner = getData(ensRry.setOwner, indexNH, accounts[2]);

    assert.equal(await ensRry.owner(indexNH), ixEnsPx.address, "init address is ixEnsPx")
    assert.equal(await ensRry.ttl(indexNH), 0, "init ttl is 0")

    await ixEnsPx.fwdToENS(ensDataSetTTL);
    assert.deepEqual(await ensRry.ttl(indexNH), toBigNumber(1337), "ttl is 1337 after fwd data")

    await ixEnsPx.fwdToENS(ensDataSetOwner)
    assert.equal(await ensRry.owner(indexNH), accounts[2], "owner changed via fwd to ENS")

    await assertRevert(ixEnsPx.fwdToENS(ensDataSetOwner, {from: accounts[2]}), "should not allow non-admins to fwd data")
    await assertRevert(ixEnsPx.fwdToENS("0xdeadbeef"), "bad method should revert")
}


const testFwdToResolver = async ({accounts, ixEnsPx, ensPR, ensRrr, ensRry, indexNH}) => {
    const _key = "theKey"
    const _val = "someValue"
    const resDataSetText1 = getData(ensPR.setText, indexNH, _key, _val)

    assert.equal(await ensPR.text(indexNH, _key), "", "test text key has no value")

    await assertRevert(ixEnsPx.fwdToResolver(resDataSetText1, {from: accounts[2]}), "don't fwd to resolver on bad auth")
    await ixEnsPx.fwdToResolver(resDataSetText1);
    assert.equal(await ensPR.text(indexNH, _key), _val, "test text key has expected value")
    await assertRevert(ixEnsPx.fwdToResolver("0xdeadbeef"), "bad method should revert")
}




contract("EnsOwnerProxy", function (accounts) {
    tests = [
        ["test ens owner init", testEnsOwnerInit],
        ["test ens return to owner", testReturnToOwner],
        ["test fwd to ens", testFwdToEns],
        ["test fwd to resolver", testFwdToResolver],
    ];
    R.map(([desc, f]) => it(desc, wrapTest({accounts}, f)), tests);
});
