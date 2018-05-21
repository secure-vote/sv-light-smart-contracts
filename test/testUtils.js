const crypto = require('crypto');
const Web3 = require('web3');
var BN = require('bn.js');
const R = require('ramda');

module.exports = function () {
    // console.log(`NOTE: test/testUtils.js is loaded.
    //     Injecting LOTS of variables into the global namespace.
    //     You should really read this file if you're reading tests.`)

    const w3 = Web3;

    this.w3 = Web3;
    this.oneEth = w3.utils.toWei(w3.utils.toBN(1), "ether");
    this.toBN = i => w3.utils.toBN(i);
    this.ethToWei = i => w3.utils.toWei(this.toBN(i), "ether");

    this.toBigNumber = i => {
        // BigNumber as in Web3 0.20.x
        return web3.toBigNumber(i.toString());
    }

    this.toJson = (obj) => {
        return JSON.stringify(obj, null, 2);
    }

    this.genRandomBytes32 = () => {
        return "0x" + crypto.randomBytes(32).toString("hex");
    };

    this.genStartEndTimes = () => {
        var startTime = Math.floor(Date.now() / 1000) - 1;
        var endTime = startTime + 600;
        return [startTime, endTime];
    }

    this.mkPackedTime = (start, end) => {
        const s = new BN(start)
        const e = new BN(end)
        return s.shln(64).add(e)
    }

    this.mkPacked = (start, end, submissionBits) => {
        const s = new BN(start)
        const e = new BN(end)
        const sb = new BN(submissionBits)
        return sb.shln(64).add(s).shln(64).add(e);
    }

    this.wrapTest = (accounts, f) => {
        return async () => {
            return await f({accounts});
        };
    };

    this.asyncAssertThrow = async (f, msg) => {
        const _msg = msg ? msg.toString() : "";
        let didError = true;
        let res = "nothing returned";
        try {
            res = await f();
            didError = false;
        } catch (e) {
            const invalidJump = e.message.search('invalid JUMP') >= 0;
            const invalidOpCode = e.message.search('invalid opcode') >= 0;
            const revert = e.message.search('VM Exception while processing transaction: revert') >= 0;
            assert(invalidJump || invalidOpCode || revert, "Expected throw, got '" + e + "' instead.");
        }

        if (!didError) {
            throw Error("Expected error didn't happen: '" + _msg + "'. Instead got: " + JSON.stringify(res) || res);
        }
    };

    this.asyncAssertDoesNotThrow = async (f, msg) => {
        let res = "nothing returned";
        let didError = false;
        let errMsg;
        try {
            res = await f();
        } catch (e) {
            didError = true;
            errMsg = e.message;
        }

        if (didError) {
            throw Error(`Did not expect throw '${msg}' and got error: ${errMsg}`);
        }
        return res;
    };

    const toAsync = f => async (...args) => {
        return new Promise((res, rej) => {
            f(...args, (e, d) => (e ? rej(e) : res(d)));
        });
    };
    this.toAsync = toAsync;

    this.getBalance = toAsync(web3.eth.getBalance);
    this.getBlockNumber = toAsync(web3.eth.getBlockNumber);
    this.getBlock = toAsync(web3.eth.getBlock);
    this.getBlockN = async () => (await this.getBlock('latest'))['number'];
    this.sendTransaction = toAsync(web3.eth.sendTransaction);
    this.getTransactionReceipt = toAsync(web3.eth.getTransactionReceipt)
    this.getTransaction = toAsync(web3.eth.getTransaction)

    // this is annoying but needed because truffle. Sigh.
    this.getData = (c, ...args) => c.request(...args).params[0].data;

    this.log = (...args) => console.log(...args);


    this.mkPromise = f => (...args) => {
        return new Promise((resolve, reject) => {
            f(...args, (err, resp) => {
                err ? reject(err) : resolve(resp);
            })
        })
    };

    this.sleep = async ms => new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    })

    this.assertRevert = async (doTx, msg) => {
        try {
            const r = await doTx
            throw Error(`Expected error but did not get one!\n${msg}`)
        } catch (e) {
            if (e.message.indexOf("VM Exception while processing transaction: revert") == -1) {
                throw e;
            }
        }
    }

    this.assertOnlyEvent = function (eventName, txResponse) {
        const _eventName = txResponse.logs[0]["event"];
        assert.equal(eventName, _eventName, "Event " + eventName + " should be emitted");
    }

    this.assertErrStatus = async (statusCode, doTx, msg) => {
        await assertRevert(doTx, msg);
        // if (tx.logs === undefined) {
        //     throw Error(`No logs object! ${tx}`);
        // }
        // const logs = tx.logs.filter(({event, args}) => event == "Error" && args.code && args.code == statusCode);
        // if (logs.length == 0) {
        //     throw Error(`Expectation: ${msg}\nExpected code ${statusCode} from ${tx.tx}. Instead got events; ${toJson(tx.logs)}`);
        // } else {
        //     console.info(`INFO: successfully detected code ${statusCode}`)
        // }
    }

    assert.eventDoesNotOccur = (eventName, tx) => {
        if (tx.logs === undefined)
            throw Error(`No logs object for txR: ${tx}`);
        const logs = tx.logs.filter(({event}) => event == eventName);
        if (logs.length !== 0)
            throw Error(`Expected not to find event ${eventName} but did!\n  TxReceipt: ${toJson(tx.logs)}`);
    }

    this.assert403 = (doTx, msg) => assertRevert(doTx) //asyncErrStatus(ERR_FORBIDDEN, f, msg);
    // with 0.4.22 we can deprecate this assert
    // this.assertNoErr = async (doTx) => assert.eventDoesNotOccur("Error", tx);
    this.assertNoErr = doTx => doTx;

    this.getEventFromTxR = (eventName, txR) => {
        for (let i = 0; i < txR.logs.length; i++) {
            const l = txR.logs[i];
            if (l.event === eventName) {
                return l
            }
        }
        throw Error(`Could not find ${eventName} - logs: \n${toJson(txR.logs)}`);
    }

    this.w3IxObjToArr = function(ixObj) {
        const toRet = [];
        let i = 0;
        while(ixObj[i] !== undefined) {
            toRet.push(ixObj[i]);
            i++;
        }
        return toRet;
    }

    this.bytes32AddrToAddr = (bytes32Addr) => {
        if (bytes32Addr.length != 66) {
            throw Error(`bytes32AddrToAddr error: not correct length: ${bytes32Addr}`);
        }
        return Web3.utils.bytesToHex(Web3.utils.hexToBytes(bytes32Addr).slice(0, 12));
    }

    // this is from the bech32 spec (Bitcoin)
    const B32_ALPHA = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    const toAlphabet = arr => {
        ret = "";
        for (let i = 0; i < arr.length; i++) {
            ret += B32_ALPHA.charAt(arr[i]);
        }
        return ret;
    }

    this.hexToB32 = hex => {
        if (hex.length == 0) return "";

        const buf = Buffer.from(hex, 'hex');
        const digits = [0];
        let digitlength = 1;

        let carry;
        for (let i = 0; i < buf.length; ++i) {
            carry = buf[i];
            for (let j = 0; j < digitlength; ++j) {
                carry += digits[j] * 256;
                digits[j] = carry % 32;
                carry = (carry / 32) | 0;
            }

            while (carry > 0) {
                digits[digitlength] = carry % 32;
                digitlength++;
                carry = (carry / 32) | 0;
            }
        }

        return toAlphabet(R.reverse(digits.slice(0,digitlength)));
    }

    this.b32ToHex = str => {

    }

    this.toHex = w3.utils.toHex

    this.bytes32zero = "0x0000000000000000000000000000000000000000000000000000000000000000";
    this.zeroHash = this.bytes32zero;
    this.zeroAddr = "0x0000000000000000000000000000000000000000";

    // submissionBits flags
    this.USE_ETH = 2**0;
    this.USE_SIGNED = 2**1;
    this.USE_NO_ENC = 2**2;
    this.USE_ENC = 2**3;

    this.IS_BINDING = 2**13;
    this.IS_OFFICIAL = 2**14;
    this.USE_TESTING = 2**15;

    // general errors
    this.ERR_FORBIDDEN = 403;
    this.ERR_500 = 500;
    this.ERR_TESTING_REQ = 599;

    // ballot box
    this.ERR_BALLOT_CLOSED = 420001;
    this.ERR_EARLY_SECKEY = 420100;
    this.ERR_ENC_DISABLED = 420200;

    this.ERR_NOT_BALLOT_ETH_NO_ENC = 420400;
    this.ERR_NOT_BALLOT_ETH_WITH_ENC = 420401;
    this.ERR_NOT_BALLOT_SIGNED_NO_ENC = 420402;
    this.ERR_NOT_BALLOT_SIGNED_WITH_ENC = 420403;

    // democ index
    this.ERR_BAD_PAYMENT = 421010;

    // admin proxy
    this.ERR_CANNOT_REMOVE_SELF = 428001;
    this.ERR_CALL_FWD_FAILED = 428500;
    this.ERR_PX_FORBIDDEN = 428403;

    // upgradable
    this.ERR_ALREADY_UPGRADED = 429001;
    this.ERR_NOT_UPGRADED = 429002;
    this.ERR_NO_UNDO_FOREVER = 429010;
    this.ERR_CALL_UPGRADED_FAILED = 429500;

    // hasAdmins
    this.ERR_NO_ADMIN_PERMISSIONS = 100001;

    // permissioned
    this.ERR_NO_EDIT_PERMISSIONS = 200001;
    this.ERR_ADMINS_LOCKED_DOWN = 201001;
};
