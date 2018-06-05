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
      solc: { optimizer: { enabled: true, runs: 1 } },  // runs=1 seems to give lowest gas usage for deploying ballots...
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


/*
    - unknown settings no solc params, runs 200 and 1 all produced this - though build artifacts existed
    Deploy Ballot Gas Costs:
    BBF1st: 263014
    BBFarm: 218014
    CommB:  286379

    Init Democ Gas Cost:
    241068

    - disabled
    Deploy Ballot Gas Costs:
    BBF1st: 263078
    BBFarm: 218078
    CommB:  286379

    Init Democ Gas Cost:
    241068

    - runs = 1
    Deploy Ballot Gas Costs:
    BBF1st: 262950
    BBFarm: 217950
    CommB:  286315

    Init Democ Gas Cost:
    241068

    - runs = 200
    Deploy Ballot Gas Costs:
    BBF1st: 263014
    BBFarm: 218014
    CommB:  286379

    Init Democ Gas Cost:
    241068


*/
