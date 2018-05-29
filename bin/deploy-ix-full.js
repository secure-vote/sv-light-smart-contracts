const fs = require('fs');
const Web3 = require('web3');
const nh = require('eth-ens-namehash')
const yargs = require('yargs');
const colors = require('colors');
const Confirm = require('prompt-confirm');
const Enquirer = require('enquirer');
const R = require('ramda');
const clip = require("node-clip")();
const assert = require('assert');


const { create, env } = require("sanctuary");
const S = create({ checkTypes: true, env });


const SV = require('sv-lib')


const DEFAULT_DIST_DIR = process.env.DEFAULT_DIST_DIR || "_solDist";
const DEFAULT_NETWORK = parseInt(process.env.DEFAULT_NETWORK) || 42;


web3 = new Web3();


const exit = (msg) => {
    logErr(msg);
    process.exit(1);
}

const exitIf = (cond, msg) => {
    if (cond) exit(msg)
}


const logFile = fs.openSync(`deploy-${(new Date()).getTime() / 1000 | 0}.log`, 'w')


const log = (msg, offset = 0) => {
    let msgStr = R.is(Object, msg) || R.is(Array, msg) ? JSON.stringify(msg, null, 2): msg.toString();
    msgStr = " ".repeat(offset) + msgStr;

    console.log(msgStr)
    fs.appendFileSync(logFile, `\n    [${(new Date()).getTime() / 1000 | 0}]    \n${msgStr}\n`)
}


const logErr = (msg, offset) => log('Error:'.red.underline.bold + ' ' + msg.red.bold, offset)
const logInfo = (msg, offset) => log(msg.green, offset)
const logInst = (msg, offset) => log(("\n>> " + msg + " <<\n").bold.white, offset)
const logData = (msg, offset) => log(msg.yellow, offset)
const logBreak = () => log('\n##############\n')


const _ld = require('./loadContractDetails');
const loadDetails = (name, distDir = DEFAULT_DIST_DIR) => {
    return _ld(name, distDir);
}


const ethHashCheck = (h, lenBytes = 32) => {
    try {
        return h.slice(0, 2) === "0x" && h.length === (lenBytes * 2 + 2);
    } catch (e) {
        console.error("Error!".red + " " + e.toString().yellow);
        console.log("exiting...");
        process.exit();
    }
};


const sendSCMethod = async (sc, method, acct, silent = true) => {

    const data = method.encodeABI()
    const to = sc.options.address
    if (acct) {
        const gas = await method.estimateGas({from: acct.address})
        const tx = {data, gas, to, value: 0}
        const {rawTransaction: signedTx} = await acct.signTransaction(tx)

        if (!silent) logInfo(`Sending to ${to} data ${data}`, 4)

        const receiptPromi = web3.eth.sendSignedTransaction(signedTx)

        if (!silent) receiptPromi.on("transactionHash", h => logInfo(`Got txid: ${h}`, 4))

        return receiptPromi
    } else {
        logInst(`Please send ${data} to ${to}`)
        await (new Confirm('Press enter when done.')).run()
        return {transactionHash: "<User Initiated Transaction>"}
    }
}


const mkDeployFresh = () => S.Nothing;


const mkDeploy = ({ dev, backend, payments, adminPxF, ballotBoxF, ensProxy, ensOwnerProxy
                  , paymentsEmergencyAdmin, ensIxDomain }) => {



}


const mkPromise = (f, ...args) => {
    return new Promise((resolve, reject) => {
        f.bind(f, ...args, (err, val) => (err ? reject(err) : resolve(val)))
    })
}


const deployContract = async ({name, deployAcct, arguments = [], srcDir = DEFAULT_DIST_DIR}) => {
    arguments.map((a, i) => {
        if (a === undefined || a === null) {
            exit(`Argument #${i} for ${name} is undefined or null!`)
        }
    })
    const [abi, bin] = loadDetails(name, srcDir)

    // prep deployment
    const sendParams = {data: "0x" + bin, from: deployAcct ? deployAcct.address : SV.const.zeroAddr}
    const contract = new web3.eth.Contract(abi, sendParams);

    const deployObj = contract.deploy({...sendParams, arguments})
    const gasEstimate = await deployObj.estimateGas();
    const deployData = deployObj.encodeABI();

    // these are the send params we want to use
    const sendParamsFinal = {...sendParams, data: deployData, gas: gasEstimate * 1.2 | 0};

    if (deployData.length < 10) {
        exit(`binary to deploy seems too short!`);
    }

    if (sendParamsFinal.gas < 70000) {
        exit(`gas seems to be low (${sendParamsFinal.gas})`);
    }

    let addr;
    if (deployAcct) {
        logInfo (`Deploying ${name} now.`)
        const signed = await deployAcct.signTransaction(sendParamsFinal);

        addr = await new Promise((resolve, reject) => {
            const r = web3.eth.sendSignedTransaction(signed.rawTransaction);
            r.on("transactionHash", h => logInfo(`Got txid: ${h}`))
            r.on("receipt", receipt => {
                logInfo(`Tx confirmed.`)
                resolve(receipt.contractAddress)
            })
            r.on("error", e => reject(e))
        })

        logInfo(`Deployed ${name} to:`)
        logData(addr, 10)
    } else {
        logInfo(`Deployment of ${name} ready.`)
        await new Promise((res, rej) => clip.writeAll(deployData, (e, d) => (e ? rej(e) : res(d))));
        logInfo(`Binary data to deploy has been copied to clipboard.`)

        logInfo(`Gas to use: `)
        logData(`${sendParamsFinal.gas}`, 10)

        logInst("Please deploy this binary to the network from the designated owner")

        const enq = new Enquirer()
        enq.question('addr', `What is the address of the deployed ${name} contract?`)
        addr = (await enq.prompt(['addr'])).addr;
    }

    logBreak()

    return addr;
}



const fullDeploy = async ({dev, deployAcct, index, backend, payments, adminPxF, bbFarm, deployOptions, globalConfig, paymentsEmergencyAdmin, ensProxy, ensOwnerProxy, ensIxDomain, ensProxyIsGen1, skipPermissions}) => {
    const _load = filename => loadDetails(filename, "_solDist");

    if (S.isNothing(deployOptions)) {
        backend = backend || await deployContract({deployAcct, name: 'SVIndexBackend'})
        payments = payments || await deployContract({deployAcct, name: 'SVPayments', arguments: [paymentsEmergencyAdmin]})
        adminPxF = adminPxF || await deployContract({deployAcct, name: 'SVAdminPxFactory'})
        bbFarm = bbFarm || await deployContract({deployAcct, name: 'BBFarm'})

        if (!index) {
            logInfo('About to deploy Index\n')

            index = index || await deployContract({
                deployAcct,
                name: 'SVLightIndex',
                arguments: [backend, payments, adminPxF, ensProxy, ensOwnerProxy, bbFarm]
            })

            logInfo(`Index deployed to ${index}!`)
        } else {
            logInfo(`Index provided at ${index}`)
        }

        if (skipPermissions) {
            logInfo("Skipping setting permissions on backends")
        } else {
            logInfo(`We need to set index permissions on backend and payments`)
            await setIndexEditorBackendPayments({backend, payments, index, deployAcct, bbFarm})
        }
        logInfo(`Next we need to configure the ens stuff.`)

        logBreak()

        await addIndexToEnsPx({deployAcct, ensIxDomain, ensProxy, index, ensProxyIsGen1})

        logBreak()

        await configEnsOwnerPx({deployAcct, ensIxDomain, index, ensOwnerProxy})
    }

}


const setIndexEditorBackendPayments = async ({deployAcct, backend, payments, index, bbFarm}) => {
    const [backendABI] = loadDetails("SVIndexBackend")
    const [paymentsABI] = loadDetails("SVPayments")
    const [bbFarmABI] = loadDetails("BBFarm")

    const cBackend = new web3.eth.Contract(backendABI, backend)
    const cPayments = new web3.eth.Contract(paymentsABI, payments)
    const cBBFarm = new web3.eth.Contract(bbFarmABI, bbFarm)

    logInfo('Setting permissions on backend')
    await sendSCMethod(cBackend, cBackend.methods.setPermissions(index, true), deployAcct, silent = false)
    logInfo('Setting permissions on payments')
    await sendSCMethod(cPayments, cPayments.methods.setPermissions(index, true), deployAcct, silent = false)
    logInfo('Setting permissions on bbfarm')
    await sendSCMethod(cBBFarm, cBBFarm.methods.setPermissions(index, true), deployAcct, silent = false)
    logInfo('Done!')
}


const addIndexToEnsPx = async ({deployAcct, ensIxDomain, ensProxy, index, ensProxyIsGen1}) => {
    const [ensProxyABI] = loadDetails("SvEnsEverythingPx")
    const [ensProxyGen1ABI] = loadDetails("SvEnsEverythingPxGen1Iface")

    if (ensProxyIsGen1) {
        logInfo("Using gen1 EnsEverythingPx")
    }

    const {cEnsPx, mkAdminCheck, setAdmin} = ensProxyGen1ABI ?
        {
            cEnsPx: new web3.eth.Contract(ensProxyGen1ABI, ensProxy),
            mkAdminCheck: async (cEnsPx, addr) => await cEnsPx.methods.admins(addr).call(),
            setAdmin: async (cEnsPx, addr) => await sendSCMethod(cEnsPx, cEnsPx.methods.addAdmin(addr), deployAcct)
        } :
        {
            cEnsPx: new web3.eth.Contract(ensProxyABI, ensProxy),
            mkAdminCheck: async (cEnsPx, addr) => await cEnsPx.methods.isAdmin(addr).call(),
            setAdmin: async (cEnsPx, addr) => await sendSCMethod(cEnsPx, cEnsPx.methods.setAdmin(addr, true), deployAcct)
        }

    if (await mkAdminCheck(cEnsPx, index) === true) {
        logInfo('Index already admin for EnsPx')
        return;
    } else {
        logInfo(`Detected index not an admin yet on EnsPx, ${await mkAdminCheck(cEnsPx, index)}`)
    }

    if (deployAcct) {
        exitIf((await mkAdminCheck(cEnsPx, deployAcct.address)) === false, `Deploy Acct is not an admin with Ens Proxy`)
    }

    logInfo(`Adding Index as admin to EnsPx`)
    const _addAdminR = await setAdmin(cEnsPx, index);
    logInfo(`Added Index as admin to EnsPx in ${_addAdminR.transactionHash}`)
}


const configEnsOwnerPx = async ({deployAcct, ensIxDomain, ensOwnerProxy, index}) => {
    const domainNode = nh.hash(ensIxDomain);
    const [domainLabel, rootLabel] = ensIxDomain.split('.', 1);
    const rootNode = nh.hash(rootLabel)

    const [ensOwnerPxABI] = loadDetails("EnsOwnerProxy");
    const cEnsOwnerPx = new web3.eth.Contract(ensOwnerPxABI, ensOwnerProxy)

    exitIf(await cEnsOwnerPx.methods.ensNode().call() !== domainNode, `Domain node (for ${ensIxDomain}) does not match EnsOwnerProxy node!`)

    const mSetAdmin = cEnsOwnerPx.methods.setAdmin(index, true)
    const mSetAddr = cEnsOwnerPx.methods.setAddr(index)

    if (deployAcct) {
        exitIf((await cEnsOwnerPx.methods.isAdmin(deployAcct.address).call()) == false, `Deploy acct is not an admin for EnsOwnerProxy`)
    }

    logInfo(`Adding index as admin to ensOwnerPx`)
    const _addAdminR = await sendSCMethod(cEnsOwnerPx, mSetAdmin, deployAcct)
    logInfo(`Added index as admin to ensOwnerPx in ${_addAdminR.transactionHash}`)

    logInfo(`Setting ${ensIxDomain} to resolve to index`)
    const _setAddrR = await sendSCMethod(cEnsOwnerPx, mSetAddr, deployAcct)
    logInfo(`Set ${ensIxDomain} to resolve to index at ${index} in ${_setAddrR.transactionHash}`)

}


const mkAddrArg = (name, demand = false) => ({
    [name]: {
        type: 'string',
        describe: `the address for ${name}. ` + (demand ? `This is required.` : `You can include this on a fresh deployment to pick up where you left off.`),
        demand,
    }
})


const main = async () => {
    const args = yargs.options({
        "distDir": {
            type: 'string',
            describe: 'contract build dir to use (expects ./CONTRACT_DIR/CONTRACT_NAME.bin to exist)',
            default: DEFAULT_DIST_DIR,
            demand: false,
        },
        "ethUrl": {
            describe: "URI for web3 provider - HTTP only",
            default: "https://kovan.eth.secure.vote:8545",
            type: 'string'
        },
        "network": {
            type: 'number',
            describe: "Network number (mainnet: 1, kovan: 42, etc)",
            default: DEFAULT_NETWORK,
            demand: true
        },
        "ownerAddr": {
            type: 'string',
            describe: 'address for the main owner',
            default: SV.const.zeroAddr
        },
        "ensIxDomain": {
            type: 'string',
            describe: 'the ens domain we\'ll deploy under',
            demand: true,
        },
        "dev": {
            type: 'boolean',
            describe: 'is this a dev deployment?',
            default: false,
            demand: false,
        },
        "fresh": {
            type: 'boolean',
            describe: 'deploy a fresh copy',
            default: false,
            demand: false,
        },
        "privkey": {
            type: 'string',
            describe: 'set this to a privkey to automatically deploy',
            demand: false
        },
        "ensProxyIsGen1": {
            type: 'boolean',
            describe: 'use gen1 of SvEnsEverythingPx',
            default: false,
            demand: false
        },
        "skipPermissions": {
            type: 'boolean',
            describe: 'skip setting permissions on backend stuff',
            default: false,
            demand: false
        },
        ...mkAddrArg("backend"),
        ...mkAddrArg("payments"),
        ...mkAddrArg("paymentsEmergencyAdmin"),
        ...mkAddrArg("adminPxF"),
        ...mkAddrArg("bbFarm"),
        ...mkAddrArg("ensProxy", true),
        ...mkAddrArg("ensOwnerProxy", true),
        ...mkAddrArg("index"),
    }).version(false).argv;

    web3.setProvider(new Web3.providers.HttpProvider(args.ethUrl));
    const networkVersion = parseInt(await web3.eth.net.getId());

    if (args.privkey) {
        logInfo(`Detected private key.`)
        args.deployAcct = await web3.eth.accounts.privateKeyToAccount(args.privkey);
        logInfo(`Deploying from ${args.deployAcct.address}`);
    }

    if (networkVersion !== args.network) {
        console.log(`Error: Detected network verison (${networkVersion}) does not match provided version (${args.network})`);
        return process.exit(1)
    }

    const deployOptions = args.fresh ? mkDeployFresh() : mkDeploy(args)
    exitIf(args.fresh == false, 'Can only do a --fresh deploy atm')
    return await fullDeploy({...args, deployOptions})

    const deployF = async () => {

        // set the contract deployment arguments
        const contractArgs = JSON.parse(args.argsJson);

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

    // if (!args.unsafeSkipChecks) {
    //     return correctDetails.run()
    //         .then(async isCorrect => {
    //             if (!isCorrect) {
    //                 log("Exiting: details not correct.")
    //                 process.exit(0);
    //             } else {
    //                 await deployF();
    //                 return
    //             }
    //         })
    // } else {
    //     return await deployF();
    // }
}


main()
    .then(() => {
        console.log("Main returned.");
    })
    .catch(err => {
        console.error("Fatal Error!".red.bold);
        console.error(err);
    });
