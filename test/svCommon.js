const Permissioned = artifacts.require("./permissioned");
const HasAdmins = artifacts.require("./hasAdmins");
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

        return await f({scLog, owner, accounts});
    };
};


const testPermissioned = async ({owner, accounts}) => {
    const [_, u1, u2, u3, u4] = accounts;
    const permissioned = await Permissioned.new();

    // can add and remove permissions
    assert.equal(await permissioned.hasPermissions(u1), false, "u1 has no perms to start with")
    await permissioned.setPermissions(u1, true);
    assert.equal(await permissioned.hasPermissions(u1), true, "u1 now has perms")
    await permissioned.setPermissions(u1, false);
    assert.equal(await permissioned.hasPermissions(u1), false, "u1 has no perms again")

    await permissioned.setPermissions(u2, true);
    assert.equal(await permissioned.hasPermissions(u2), true, "u2 has perms")
    await permissioned.upgradePermissionedSC(u2, u3);
    assert.equal(await permissioned.hasPermissions(u2), false, "u2 lost perms in upgrade")
    assert.equal(await permissioned.hasPermissions(u3), true, "u3 has perms via upgrade")


    await permissioned.setAdmin(u2, true, {from: owner});
    await permissioned.doLockdown();
    await assertRevert(permissioned.setAdmin(u2, true, {from: owner}), "cannot set admin after lockdown");

    assert.equal(await permissioned.hasPermissions(u3), true, "u3 was granted perms")
    await permissioned.upgradeMe(u4, {from: u3});
    assert.equal(await permissioned.hasPermissions(u3), false, "u3 no longer has perms")
    assert.equal(await permissioned.hasPermissions(u4), true, "u4 got perms via upgrade")
    await assertRevert(permissioned.upgradeMe(u4, {from: u3}), "cannot upgrade again");
}


const testHasAdmins = async ({owner, accounts}) => {
    const [_, u1, u2, u3, u4] = accounts;
    const hasAdmins = await HasAdmins.new();

    await hasAdmins.setAdmin(u1, true);
    await assertRevert(hasAdmins.setAdmin(u1, false, {from: u1}), "cannot change own perms")
    await assertRevert(hasAdmins.setAdmin(owner, false, {from: u1}), "cannot remove owner")
    await hasAdmins.setAdmin(u2, true, {from: u1});

    assert.equal(await hasAdmins.isAdmin(u1), true, "u1 admin before epoch++")
    await hasAdmins.incAdminEpoch({from: owner});
    assert.equal(await hasAdmins.isAdmin(u1), false, "u1 not admin after epoch++")

    await assertRevert(hasAdmins.setAdmin(u2, true, {from: u1}), "u1 cannot make admin txs")
}




contract("SVCommon", function (accounts) {
    tests = [
        ["test permissioned contract", testPermissioned],
        ["test hasAdmins", testHasAdmins],
    ];
    R.map(([desc, f]) => it(desc, wrapTest({accounts}, f)), tests);
});
