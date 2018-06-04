var TestRPC = require("ethereumjs-testrpc");

const { create, env } = require("sanctuary");
const S = create({ checkTypes: true, env });

// upgrading to ganache-cli seems to have broken this >.< - use ethereumjs-testrpc for now
var provider = TestRPC.provider({
  port: 34839,
  accounts: S.map(_ => ({ balance: "0xffffffffffffffffff" }), S.range(0, 20)),
  gasLimit: 20000000
});

module.exports = {
  networks: {
    development: {
      provider,
      // host: "localhost",
      // port: 8545,
      // port: 9545,
      gas: 19000000,
      network_id: "*", // Match any network id
      gasPrice: 1,
      // solc: { optimizer: { enabled: true, runs: 200 } },
    },
    testrpc: {
      host: "localhost",
      port: 8545,
      network_id: "*",
      gas: 7000000,
      gasPrice: 1,
    }
  }
};
