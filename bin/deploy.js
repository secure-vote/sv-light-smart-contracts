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
        "scName": {
            type: 'string',
            describe: "The contract name of an alternate contract to deploy, do not include '.sol'",
            demand: true
        },
        "scSrc": {
            type: 'string',
            describe: 'contract build dir to use (expects ./CONTRACT_DIR/CONTRACT_NAME.bin to exist)',
            default: "_solDist",
            demand: false,
        },
        "web3": {
            describe: "URI for web3 provider - HTTP only",
            default: "https://kovan.eth.secure.vote:8545",
            type: 'string'
        },
        "argsJson": {
            type: 'string',
            describe: "Args to provide with scName in json encoding - required for deploying arbitrary",
            demand: true
        },
        "deploy": {
            type: 'boolean',
            describe: 'deploy automatically',
            demand: false,
            default: false
        },
        "privkey": {
            type: 'string',
            describe: 'privkey to deploy with',
            demand: false,
            default: undefined,
        }
    }).help(false).version(false).argv;

    if (!args.scName) {
        log("Error:".bgRed.white + " Need to provide scName")
        process.exit(1);
    }

    const scName = args.scName;
    const [abi, bin] = loadDetails(scName, args.scSrc);

    web3.setProvider(new Web3.providers.HttpProvider(args.web3));

    let coinbase, deployAcct;
    if (args.privkey) {
        deployAcct = await web3.eth.accounts.privateKeyToAccount(args.privkey);
        coinbase = deployAcct.address;
    } else {
        coinbase = await web3.eth.getCoinbase();
    }


    log("\n\nSummary of Deployment:\n".cyan.bold)
    log("Sending from: " + coinbase.yellow, 2);
    log("\nBe sure to " + "double and triple check".magenta + " these before you go live!\n")

    log(">>> THIS IS THE LAST OPPORTUNITY YOU HAVE TO CHANGE THEM <<<".bgYellow.black + "\n")

    const correctDetails = new Confirm("Are these details _all_ correct?");

    // MEAT OF SCRIPT IS HERE

    const deployF = async () => {
        const sendParams = {data: "0x" + bin, from: coinbase};

        const contract = new web3.eth.Contract(abi, sendParams);

        // set the contract deployment arguments
        const contractArgs = JSON.parse(args.argsJson);

        // organise our arguments for getting final bytecode
        const deployObj = contract.deploy({data: sendParams.data, arguments: contractArgs});
        const estGas = await deployObj.estimateGas();
        const binaryData = deployObj.encodeABI();

        const compiledSendParams = R.merge(sendParams, {data: binaryData, gas: estGas * 1.2 | 0});

        if (args.deploy && args.privkey) {
            log("About to deploy...")
            log("NOTE:".yellow + " The cli will become unresponsive until the transaction confirms. Please be patient. \n\n")
            log("\nContract Deploying!\n".green);


            // const deployCallback = (err, deployed) => {
            //     if (err) {
            //         log("WARNING:".red + " Ran into an error while deploying contract:")
            //         log(err);
            //         log("\nStringified error: " + JSON.stringify(err));
            //         process.exit(1);
            //     } else {
            //         log("Tx Hash: " + deployed.transactionHash.green);
            //         if (deployed.address) {
            //             log("Contract Addr: " + deployed.address.green + "\n\n");
            //             log("          >>> Job Done - Exiting <<<          ".bgGreen.black)
            //             process.exit(0);
            //         } else {
            //             log("Awaiting a confirmation...\n".cyan);
            //         }
            //     }
            // };

            // organise our final arguments and deploy!
            const signed = await deployAcct.signTransaction(compiledSendParams);
            const r = web3.eth.sendSignedTransaction(signed.rawTransaction);
            r.on("transactionHash", hash => {
                console.log("Got Tx Hash".green, hash.yellow);
            })
            r.on("receipt", receipt => {
                console.log("Got Tx Receipt!".green);
                console.log("Contract Addr:".green, receipt.contractAddress.yellow);
            })
            return r;
        } else {
            log("Contract to deploy:\n".green.bold);
            log(JSON.stringify(compiledSendParams, null, 2))
            log("\n\n^^^ Contract parameters to deploy are above ^^^\n".green.bold)

            console.log("Gas estimate: ", estGas);
        }
    }

    if (!args.unsafeSkipChecks) {
        return correctDetails.run()
            .then(async isCorrect => {
                if (!isCorrect) {
                    log("Exiting: details not correct.")
                    process.exit(0);
                } else {
                    await deployF();
                    return
                }
            })
    } else {
        return await deployF();
    }
}


main()
    .then(() => {
        console.log("Main returned.");
    })
    .catch(err => {
        console.error("Fatal Error!".red.bold);
        console.error(err);
    });
