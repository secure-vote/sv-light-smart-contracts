const fs = require('fs');
const Web3 = require('web3');
const yargs = require('yargs');
const colors = require('colors');
const Confirm = require('prompt-confirm');
const R = require('ramda');


web3 = new Web3();


const log = (msg, offset = 0) => {
    if (offset > 0) {
        console.log(" ".repeat(offset - 1), msg)
    } else {
        console.log(msg)
    }
}


loadDetails = require('./loadContractDetails');


const ethHashCheck = (h, lenBytes = 32) => {
    try {
        return h.slice(0, 2) === "0x" && h.length === (lenBytes * 2 + 2);
    } catch (e) {
        console.error("Error!".red + " " + e.toString().yellow);
        console.log("exiting...");
        process.exit();
    }
};



const main = async () => {
    const args = yargs.options({
        "name": {
            type: 'string',
            describe: "The contract name of an alternate contract to deploy, do not include '.sol'",
            demand: true
        },
        "src": {
            type: 'string',
            describe: 'contract build dir to use (expects ./CONTRACT_DIR/CONTRACT_NAME.{bin,abi} to exist)',
            default: "_solDist",
            demand: false,
        },
        "web3": {
            describe: "URI for web3 provider - HTTP only",
            default: "https://kovan.eth.secure.vote:8545",
            type: 'string'
        },
        "args": {
            type: 'string',
            describe: "Args to provide with scName in json encoding - required",
            demand: true
        },
        "method": {
            type: 'string',
            describe: 'the method to call on the contract',
            demand: true,
        }
    }).help(false).version(false).argv;

    if (!args.name) {
        log("Error:".bgRed.white + " Need to provide scName")
        process.exit(1);
    }

    const {name, method, src} = args
    const [abi, bin] = loadDetails(name, src);

    web3.setProvider(new Web3.providers.HttpProvider(args.web3));

    const contract = new web3.eth.Contract(abi)

    const txArgs = JSON.parse(args.args)

    const txData = contract.methods[method](...txArgs).encodeABI()

    console.log(`Contract name: ${name}`.green)
    console.log(`Method: ${method}`.green)
    console.log(`Args: ${txArgs}`.green)
    console.log(`Calling: ${name}.${method}(${txArgs.join(', ')})`.yellow)
    console.log("Tx data:\n".green)
    console.log(txData.yellow)
    console.log("")
}


main()
    .then(() => {
        // console.log("Main returned.");
    })
    .catch(err => {
        console.error("Fatal Error!".red.bold);
        console.error(err);
    });
