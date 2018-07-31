const SelfDelegaiton = artifacts.require("./UnsafeEd25519SelfDelegation");
const EmitterTesting = artifacts.require("./EmitterTesting");

const { prepareEd25519Delegation, ed25519DelegationIsValid } = require('sv-lib/lib/light')

const nacl = require('tweetnacl')

require("./testUtils")();


const genDelegation = () => {
    const kp = nacl.sign.keyPair()
    const addr = w3.utils.randomHex(20)
    const nonce = w3.utils.randomHex(3)

    return mkDelegation(addr, nonce, kp)
}


const mkDelegation = (toAddr, nonce, kp) => {
    const dlgtReq = prepareEd25519Delegation(toAddr, nonce);

    const sigRaw = nacl.sign.detached(hexToUint8Array(dlgtReq), kp.secretKey)

    const sig1 = w3.utils.bytesToHex(sigRaw.slice(0, 32))
    const sig2 = w3.utils.bytesToHex(sigRaw.slice(32))
    const pk = w3.utils.bytesToHex(kp.publicKey)

    return {data: [dlgtReq, pk, [sig1, sig2]], kp, toAddr}
}


const wrapTest = ({accounts}, f) => {
    console.log("wrapTest called")
    return async () => {
        console.log("wrapTest run")
        const owner = accounts[0];

        const scLog = await EmitterTesting.new();

        // use this doLog function in the wrapper to easily turn on and off this logging
        // just in this initialization function
        let loggingActive = true;
        const doLog = async msg => {
            if (loggingActive)
                return await scLog.log(msg);
        }

        await doLog(`Created logger...`);

        const selfDelegation = await SelfDelegaiton.new();

        await doLog(`Created self delegation SC at: ${selfDelegation.address}`)

        return await f({selfDelegation, doLog, owner, accounts}, accounts);
    };
};


const testTemplate = async ({selfDelegation, doLog, owner, accounts}) => {
    const [_, u1, u2, u3, u4, u5] = accounts;
}


const testInit = async ({selfDelegation, doLog, owner, accounts}) => {
    const [_, u1, u2, u3, u4, u5] = accounts;

    assert.equal(await selfDelegation.dLogN(), 0, 'no delegations')
    assert.equal(await selfDelegation.nDelegations(zeroHash), 0, 'no delegations (pk)')
    assert.equal(await selfDelegation.nAddressLog(), 0, 'no delegatees')
    assert.deepEqual(await selfDelegation.getAllForPubKey(zeroHash), [[],[],[],[]], 'no delegations for pk')
}


const testDelegation = async ({selfDelegation, doLog, owner, accounts}) => {
    const [_, u1, u2, u3, u4, u5] = accounts;

    // generate and perform first delegation
    const d1 = genDelegation()
    await doLog(`d1.data: ${toJson(d1.data)}`)
    await selfDelegation.addUntrustedSelfDelegation(...d1.data)
    const d1Dlgtions = await selfDelegation.getAllForPubKey(d1.data[1])
    const expectedD1 = [[d1.data[0]], [d1.data[2][0]], [d1.data[2][1]]]

    // verify first delegaiton
    assert.equal(await selfDelegation.dLogN(), 1, '1 pk - dlgtion')
    assert.equal(await selfDelegation.nDelegations(d1.data[1]), 1, '1 dlgtion for pk')
    assert.equal(await selfDelegation.nAddressLog(), 1, '1 addr - dlgtion')
    assert.deepEqual(d1Dlgtions.slice(0,3), expectedD1, 'dlgation 1 match, sans timestamp')
}


const testReverts = async ({selfDelegation, doLog, owner, accounts}) => {
    const [_, u1, u2, u3, u4, u5] = accounts;
}


contract("UnsafeEd25519SelfDelegation", function (accounts) {
    console.log("main called")
    tests = [
        ["test init", testInit],
        ["test delegation", testDelegation],
        ["test reverts", testReverts],
    ];
    R.map(([desc, f]) => it(desc, wrapTest({accounts}, f)), tests);
});
