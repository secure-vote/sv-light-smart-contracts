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

const mkBadHdrDelegation = (toAddr, nonce, kp) => {
    let dlgtReq = prepareEd25519Delegation(toAddr, nonce);

    // corrupt the header - this part is constant so 0 always invalid
    dlgtReq = "0x00" + dlgtReq.slice(4)

    const sigRaw = nacl.sign.detached(hexToUint8Array(dlgtReq), kp.secretKey)

    const sig1 = w3.utils.bytesToHex(sigRaw.slice(0, 32))
    const sig2 = w3.utils.bytesToHex(sigRaw.slice(32))
    const pk = w3.utils.bytesToHex(kp.publicKey)

    return {data: [dlgtReq, pk, [sig1, sig2]], kp, toAddr}
}


const wrapTest = ({accounts}, f) => {
    return async () => {
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

    // do another delegation
    const d2 = mkDelegation(d1.toAddr, w3.utils.randomHex(3), d1.kp)
    await selfDelegation.addUntrustedSelfDelegation(...d2.data)
    const d2Dlgtions = await selfDelegation.getAllForPubKey(d2.data[1])
    const expectedD2 = R.compose(R.map(R.flatten), R.zip(expectedD1))([[d2.data[0]], [d2.data[2][0]], [d2.data[2][1]]])

    assert.equal(await selfDelegation.dLogN(), 1, '1 pk - dlgtion')
    assert.deepEqual(await selfDelegation.nDelegations(d1.data[1]), toBigNumber(2), '2 dlgtion for pk')
    assert.equal(await selfDelegation.nAddressLog(), 1, '1 addr - dlgtion')
    assert.deepEqual(d2Dlgtions.slice(0,3), expectedD2, 'dlgation 2 match, sans timestamp')

    // do test with silly time range to get 0 results
    assert.deepEqual(await selfDelegation.getAllForPubKeyBetween(d2.data[1], 0, 1), [[],[],[],[]], 'dlgation get with silly timestamps returns empty')
}


const testReverts = async ({selfDelegation, doLog, owner, accounts}) => {
    const [_, u1, u2, u3, u4, u5] = accounts;

    const kp = nacl.sign.keyPair()
    const addr = w3.utils.randomHex(20)
    const nonce = w3.utils.randomHex(3)

    const d1 = mkBadHdrDelegation(addr, nonce, kp)

    // bad header
    await asyncAssertThrow(() => selfDelegation.addUntrustedSelfDelegation(...d1.data), 'bad header fails')
    // do replay

    const d2 = genDelegation()
    await selfDelegation.addUntrustedSelfDelegation(...d2.data)
    await asyncAssertThrow(() => selfDelegation.addUntrustedSelfDelegation(...d2.data), 'replay fails')
}


contract("UnsafeEd25519SelfDelegation", function (accounts) {
    tests = [
        ["test init", testInit],
        ["test delegation", testDelegation],
        ["test reverts", testReverts],
    ];
    R.map(([desc, f]) => it(desc, wrapTest({accounts}, f)), tests);
});
