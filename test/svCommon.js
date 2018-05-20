// const SVCommon = artifacts.require("./SVCommon.sol");

require("./testUtils")();

const AsyncPar = require("async-parallel");

const {create, env} = require("sanctuary");
const S = create({checkTypes: true, env});


async function testOwner({accounts}) {
}


const testPayments = async ({accounts}) => {
}


contract("SVCommon", function (_accounts) {
    tests = [];
    //     ["end-to-end-ish", testOwner],
    //     ["payment amounts", testPayments],

    // ];
    S.map(([desc, f]) => it(desc, wrapTest(_accounts, f)), tests);
});
