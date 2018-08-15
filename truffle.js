const l = str => console.log(new Date().getTime() / 1000, 'truffle.js:', str)
l("Loading truffle.js")

// var TestRPC = require("ethereumjs-testrpc");

const { create, env } = require("sanctuary");
const S = create({ checkTypes: true, env });
l("init'd sactuary")

let provider = null
const loadGanacheProvider = () => {
  const w3Utils = require('web3-utils')
  const ganache = require("ganache-cli");

  l("Loaded ganache; declaring provider")

  const accounts = S.map(i => ({ balance: "0xffffffffffffffffffffff", secretKey: w3Utils.padLeft(w3Utils.toHex(i+10), 64)}), S.range(0, 20))
  // console.log("Development network accounts: ", accounts)

  provider = ganache.provider({
    port: 34839,
    accounts,
    gasLimit: 20000000,
    db_path: "./db",
  })

  l("provider init'd")

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
          return provider.send
          // // this pattern started breaking with ganache 6.1.6
          // return (...args) => new Promise((resolve, reject) => {
          // provider.send(...args, (err, val) => {
          //   err ? reject(err) : resolve(val);
          // })
          // })
      }
      return obj[method]
    }
  })

  l("Created provider + sendAsync shim")
}

// let's check if we need to load the ganache provider
const devNetwork = "development"
const networkArgM = S.head (S.filter (a => a.indexOf("--network") >= 0) (process.argv))

// if we have a nothing the default is the dev network => provider needed
S.maybe_ (loadGanacheProvider) (_netarg => {
  // if this is triggered it means we have found the network arg
  const networkNameFromArg = _netarg.split("=", 1)[1]
  if (networkNameFromArg !== devNetwork || !process.argv.includes(devNetwork)) {
    // in this case it's safe _NOT_ to load the ganache provider
  } else {
    loadGanacheProvider()
  }
}) (networkArgM)


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
    },
    rpc: {
      network_id: "*",
      host: 'localhost',
      port: 8545,
      gas: 1e7,
      gasPrice: 1,
    },
  }
};

l("declared exports")
