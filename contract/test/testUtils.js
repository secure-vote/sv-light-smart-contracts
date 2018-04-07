const crypto = require('crypto');

module.exports = function () {
    this.toJson = (obj) => {
        return JSON.stringify(obj, null, 2);
    }

    this.genRandomBytes32 = () => {
        return "0x" + crypto.randomBytes(32).toString("hex");
    };

    this.wrapTest = (accounts, f) => {
        return async () => {
            return await f(accounts);
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

    this.log = (...args) => console.log(...args);


    this.mkPromise = f => (...args) => {
        return new Promise((resolve, reject) => {
            f(...args, (err, resp) => {
                err ? reject(err) : resolve(resp);
            })
        })
    };

    this.assertOnlyEvent = function (eventName, txResponse) {
        const _eventName = txResponse.logs[0]["event"];
        assert.equal(eventName, _eventName, "Event " + eventName + " should be emitted");
    }

    this.assertErrStatus = (statusCode, tx, msg) => {
        if (tx.logs === undefined) {
            throw Error(`No logs object! ${tx}`);
        }
        const logs = tx.logs.filter(({event, args}) => event == "Error" && args.code && args.code == statusCode);
        if (logs.length == 0) {
            throw Error(`Expectation: ${msg}\nExpected code ${statusCode} from ${tx.tx}. Instead got events; ${toJson(tx.logs)}`);
        } else {
            console.info(`INFO: successfully detected code ${statusCode}`)
        }
    }

    this.asyncErrStatus = async (statusCode, f, msg) => {
        res = await f();
        return this.assertErrStatus(statusCode, res, msg);
    }

    assert.eventDoesNotOccur = (eventName, tx) => {
        if (tx.logs === undefined) 
            throw Error(`No logs object for txR: ${tx}`);
        const logs = tx.logs.filter(({event}) => event == eventName);
        if (logs.length !== 0) 
            throw Error(`Expected not to find event ${eventName} but did!\n  TxReceipt: ${toJson(tx.logs)}`);
    }

    this.getEventFromTxR = function(eventName, txR) {
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


    // general errors
    this.ERR_FORBIDDEN = 403;
    this.ERR_500 = 500;
    this.ERR_TESTING_REQ = 599;

    // ballot box
    this.ERR_BALLOT_CLOSED = 420001;
    this.ERR_EARLY_SECKEY = 420100;
    this.ERR_ENC_REQ = 420200;
    this.ERR_DO_NOT_USE_ENC = 420201;

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
};
