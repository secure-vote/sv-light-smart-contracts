var TestRPC = require("ethereumjs-testrpc");

const { create, env } = require("sanctuary");
const S = create({ checkTypes: true, env });

var provider = TestRPC.provider({
  port: 34839,
  accounts: S.map(_ => ({ balance: "0xffffffffffffffffff" }), S.range(0, 20))
});

module.exports = {
  networks: {
    development: {
      provider,
      // host: "localhost",
      // port: 8545,
      // port: 9545,
      gas: 6500000,
      network_id: "*" // Match any network id
    }
  }
};
