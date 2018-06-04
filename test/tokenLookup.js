const TAL = artifacts.require("./TokenAbbreviationLookup")
const EmitterTesting = artifacts.require("./EmitterTesting")

require("./testUtils")();

const wrapTestNoPrep = ({accounts}, f) => {
    return async () => {
        return await f({accounts})
    }
}

const wrapTest = ({accounts}, f) => {
    return async () => {
        const owner = accounts[0];

        const scLog = await EmitterTesting.new();

        // use this doLog function in the wrapper to easily turn on and off this logging
        const loggingActive = true;
        const doLog = async msg => {
            if (loggingActive)
                return await scLog.log(msg);
        }

        await doLog(`Created logger...`);

        const tal = await TAL.new();

        return await f({owner, accounts, doLog, tal});
    };
};


const testTAL = async ({owner, accounts, doLog, tal}) => {
    const [, u1, u2] = accounts;

    // assert.deepEqual(await tal.lookupSince(0), [[], []], 'init sanity check');

    const b = await getBlock('latest')
    const t1 = b.timestamp;
    await increaseTime(5);

    assert.deepEqual(await tal.nEdits(), toBigNumber(0), 'edits 0')

    await tal.addRecord("MAX", "0x01", false)
    await tal.addRecord("BRUCE", "0x02", true)
    await tal.addRecord(w3.utils.asciiToHex("3"), "0x03", false)

    assert.deepEqual(await tal.nEdits(), toBigNumber(3), 'edits 3')

    await increaseTime(100);
    await tal.setAdmin(u1, true)
    const {timestamp: t2} = await getBlock('latest')
    await increaseTime(5);
    // t2 is 5s before these records were added
    await tal.addRecord("SUGAR", "0x112233445566778899", false, {from: u1})
    await tal.addRecord("MAX", "0x1337", false, {from: u1})
    assertRevert(tal.addRecord("MYSWEETDEMOC", "0x1234", false, {from: u2}))

    assert.deepEqual(await tal.nEdits(), toBigNumber(5), 'edits 5')

    // verify individual

    assert.deepEqual(await tal.lookup("MAX"), ["0x1337000000000000000000000000000000000000000000000000000000000000", false], 'lookup MAX')
    assert.deepEqual(await tal.lookup("BRUCE"), ["0x0200000000000000000000000000000000000000000000000000000000000000", true], 'lookup BRUCE')
    assert.deepEqual(await tal.lookup(w3.utils.asciiToHex("3")), ["0x0300000000000000000000000000000000000000000000000000000000000000", false], 'lookup 3')
    assert.deepEqual(await tal.lookup("SUGAR"), ["0x1122334455667788990000000000000000000000000000000000000000000000", false], 'lookup SUGAR')

    // verify mass

    const allRecs = await tal.lookupAllSince(0);
    const allRecs2 = await tal.lookupAllSince(t1);
    // since we moved forward 100s, this should exclude records added before t2
    const recent = await tal.lookupAllSince(t2);

    assert.deepEqual(recent, [
        [ "0x5355474152000000000000000000000000000000000000000000000000000000"
        , "0x4d41580000000000000000000000000000000000000000000000000000000000"
        ],
        [ "0x1122334455667788990000000000000000000000000000000000000000000000"
        , "0x1337000000000000000000000000000000000000000000000000000000000000"
        ], [false, false]], 'recent should match')
    assert.deepEqual(allRecs, [
        [ "0x4d41580000000000000000000000000000000000000000000000000000000000"
        , "0x4252554345000000000000000000000000000000000000000000000000000000"
        , "0x3300000000000000000000000000000000000000000000000000000000000000"
        , "0x5355474152000000000000000000000000000000000000000000000000000000"
        , "0x4d41580000000000000000000000000000000000000000000000000000000000"
        ],
        [ "0x1337000000000000000000000000000000000000000000000000000000000000"
        , "0x0200000000000000000000000000000000000000000000000000000000000000"
        , "0x0300000000000000000000000000000000000000000000000000000000000000"
        , "0x1122334455667788990000000000000000000000000000000000000000000000"
        , "0x1337000000000000000000000000000000000000000000000000000000000000"
        ], [false, true, false, false, false]], 'allRecs should match expected')
    assert.deepEqual(allRecs, allRecs2, "sanity check")
}


contract("TokenAbbreviationLookup", function (accounts) {
    tests = [
        ["test TAL", testTAL],
    ];
    R.map(([desc, f, skip]) => it(desc, skip === true ? wrapTestNoPrep({accounts}, f) : wrapTest({accounts}, f)), tests);
});
