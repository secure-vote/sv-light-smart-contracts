var TestRPC = require("ethereumjs-testrpc");

const { create, env } = require("sanctuary");
const S = create({ checkTypes: true, env });

var ganache = require("ganache-cli");

let provider = ganache.provider({
  port: 34839,
  accounts: S.map(_ => ({ balance: "0xffffffffffffffffff" }), S.range(0, 20)),
  gasLimit: 20000000
})

// needed to make ganache-cli work...
// curiously, if you don't have this AND don't have gasLimit high, then truffle
// crashes with "exceeds block gas limit", so some communication must be going
// on earlier. If you do have the gas limit, then the error msg becomes
// "this.provider.sendAsync is not a function"
provider = new Proxy(provider, {
  get: (obj, method) => {
    if(method in obj) {
      return obj[method]
    }
    if(method === "sendAsync"){
        return (...args) => new Promise((resolve, reject) => {
        provider.send(...args, (err, val) => {
          err ? reject(err) : resolve(val);
        })
      })
    }
    return obj[method]
  }
})

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
      // solc: { optimizer: { enabled: true, runs: 1 } },  // runs=1 seems to give lowest gas usage for deploying ballots...
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
