const Permissioned = artifacts.require("./permissioned");
const HasAdmins = artifacts.require("./hasAdmins");
const EmitterTesting = artifacts.require("./EmitterTesting");
const safeSend = artifacts.require("./safeSend")
const payoutAllC = artifacts.require("./payoutAllC")
const payoutAllCSettable = artifacts.require("./payoutAllCSettableTest")
const TestHelper = artifacts.require("./TestHelper")

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


const testSafeSend = async({owner, accounts}) => {
    // scaffold taken from old adminProxy testReentrancy test

    const [, u1, u2, u3, u4, u5] = accounts;
    // use lots of gas
    const gas = 5000000
    const freetx = {gasPrice: 0}

    const scLog = await EmitterTesting.new(freetx)
    const log = async (msg) => await scLog.log(msg, freetx);
    await log("Created scLog")

    const testHelper = await TestHelper.new(freetx)
    const th = testHelper.address
    await log("created testHelper")

    // function sendTo(address to, uint value) external;
    const safeSender = await payoutAllCSettable.new(u1);
    await safeSender.sendTransaction({value: oneEth.times(10)})

    // the tx that triggers reentrancy check
    const tx1 = getData(safeSender.sendTo, u1, "0x", oneEth);
    // the tx that will fwd back to safeSender
    const tx2 = getData(testHelper.reentrancyHelper, safeSender.address, tx1, oneEth.times(1.1))

    // make sure this works atm
    await testHelper.sendTransaction({value: oneEth.times(1.2), data: tx2, ...freetx})

    // and now we trigger!
    await assertRevert(safeSender.sendTo(th, tx2, oneEth.times(1.2), {value: oneEth.times(1.3), ...freetx}), 'this should trigger safeSend check');
}


const testPayoutAllC = async({owner, accounts}) => {
    const [,u1,u2,u3] = accounts;

    await asyncAssertThrow(() => payoutAllC.new(0), 'payoutAllC assert-throws on 0 addr')

    const c = await payoutAllCSettable.new(u1);
    assert.equal(await c.getPayTo(), u1, 'payoutAllCSettable returns owner on getPayTo')
    await c.setPayTo(u2);
    assert.equal(await c.getPayTo(), u2, 'payoutAllCSettable returns u2 on getPayTo (after setting)')
}



contract("SVCommon", function (accounts) {
    tests = [
        ["test permissioned contract", testPermissioned],
        ["test hasAdmins", testHasAdmins],
        ["test safeSend + reentrancy", testSafeSend],
        ["test payoutAllC", testPayoutAllC],
    ];
    R.map(([desc, f]) => it(desc, wrapTest({accounts}, f)), tests);
});
