pragma solidity ^0.4.22;


//
// The Index by which democracies and ballots are tracked (and optionally deployed).
// Author: Max Kaye <max@secure.vote>
// License: MIT
// version: v1.2.0 [WIP]
//


import { SVLightBallotBox } from "./SVLightBallotBox.sol";
import { SVLightAdminProxy } from "./SVLightAdminProxy.sol";
import { canCheckOtherContracts, permissioned, hasAdmins, owned, upgradePtr } from "./SVCommon.sol";
import { StringLib } from "../libs/StringLib.sol";
import { SvEnsEverythingPx } from "../../ensSCs/contracts/SvEnsEverythingPx.sol";
import { Triggerable } from "./Triggerable.sol";


contract SVAdminPxFactory {
    function spawn(address initAdmin, address fwdTo) external returns (SVLightAdminProxy px) {
        px = new SVLightAdminProxy(initAdmin, fwdTo);
    }
}


contract SVBBoxFactory {
    function spawn(bytes32 _specHash, uint64 _startTs, uint64 endTs, uint16 _submissionBits, address admin) external returns (SVLightBallotBox bb) {
        bb = new SVLightBallotBox(_specHash, _startTs, endTs, _submissionBits);
        bb.setOwner(admin);
    }
}


contract SVIndexBackend is permissioned {
    event LowLevelNewBallot(bytes32 democHash, uint id);
    event LowLevelNewDemoc(bytes32 democHash);

    struct Ballot {
        bytes32 specHash;
        bytes32 extraData;
        SVLightBallotBox bb;
        uint64 startTs;
        uint64 endTs;
    }

    struct Democ {
        string name;
        address admin;
        Ballot[] ballots;
    }

    mapping (bytes32 => Democ) public democs;
    mapping (bytes13 => bytes32) public democPrefixToHash;
    bytes32[] public democList;

    //* GLOBAL INFO */

    function nDemocs() external constant returns (uint256) {
        return democList.length;
    }

    //* DEMOCRACY FUNCTIONS - INDIVIDUAL */

    function initDemoc(string democName, address admin) only_editors() external returns (bytes32 democHash) {
        // generating the democHash in this way guarentees it'll be unique/hard-to-brute-force
        // (particularly because `this` and prevBlockHash are part of the hash)
        democHash = keccak256(democName, admin, democList.length, blockhash(block.number-1), this);
        democList.push(democHash);
        democs[democHash].name = democName;
        democs[democHash].admin = admin;
        democPrefixToHash[bytes13(democHash)] = democHash;
        emit LowLevelNewDemoc(democHash);
    }

    function getDemocInfo(bytes32 democHash) external constant returns (string name, address admin, uint256 nBallots) {
        return (democs[democHash].name, democs[democHash].admin, democs[democHash].ballots.length);
    }

    function getDName(bytes32 democHash) external constant returns (string) {
        return democs[democHash].name;
    }

    function getDAdmin(bytes32 democHash) external constant returns (address) {
        return democs[democHash].admin;
    }

    function setAdmin(bytes32 democHash, address newAdmin) only_editors() external {
        democs[democHash].admin = newAdmin;
    }

    function nBallots(bytes32 democHash) external constant returns (uint256) {
        return democs[democHash].ballots.length;
    }

    function getNthBallot(bytes32 democHash, uint256 n) external constant returns (bytes32 specHash, bytes32 extraData, SVLightBallotBox bb, uint64 startTime, uint64 endTime) {
        Ballot memory b = democs[democHash].ballots[n];
        return (b.specHash, b.extraData, b.bb, b.startTs, b.endTs);
    }

    function getBallotBox(bytes32 democHash, uint id) external constant returns (SVLightBallotBox bb) {
        bb = democs[democHash].ballots[id].bb;
    }

    //* ADD BALLOT TO RECORD */

    function _commitBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, SVLightBallotBox bb, uint64 startTs, uint64 endTs) internal returns (uint ballotId) {
        ballotId = democs[democHash].ballots.length;
        democs[democHash].ballots.push(Ballot(specHash, extraData, bb, startTs, endTs));
        emit LowLevelNewBallot(democHash, ballotId);
    }

    function addBallot(bytes32 democHash, bytes32 extraData, SVLightBallotBox bb) only_editors() external returns (uint ballotId) {
        bytes32 specHash = bb.specHash();
        uint64 startTs = bb.startTime();
        uint64 endTs = bb.endTime();
        ballotId = _commitBallot(democHash, specHash, extraData, bb, startTs, endTs);
    }

    // function deployBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, uint64 _startTs, uint64 endTs, uint16 _submissionBits, SVBBoxFactory bbF, address admin) only_editors() external returns (uint id) {
    //     // the start time is max(startTime, block.timestamp) to avoid a DoS whereby a malicious electioneer could disenfranchise
    //     // token holders who have recently acquired tokens.
    //     SVLightBallotBox bb = bbF.spawn(specHash, _startTs, endTs, _submissionBits, admin);
    //     id = _commitBallot(democHash, specHash, extraData, bb, bb.startTime(), endTs);
    // }

    // utils
    function max(uint64 a, uint64 b) pure internal returns(uint64) {
        if (a > b) {
            return a;
        }
        return b;
    }
}


contract SVIndexPaymentSettings is permissioned {
    event SetFees(uint[2] _newFees);
    event PaymentEnabled(bool _feeEnabled);

    // addresses that do not have to pay for democs
    mapping (address => bool) public democWhitelist;
    // democs that do not have to pay for issues
    mapping (address => bool) public ballotWhitelist;

    // payment details
    address public payTo;
    // uint128's used because they account for amounts up to 3.4e38 wei or 3.4e20 ether
    uint public democFee = 1.0 ether; // 1.0 ether; about $500 at 18 Apr 2018
    mapping (address => uint) public democFeeFor;
    uint public ballotFee = 0.1 ether; // 0.1 ether; about $50 at 18 Apr 2018
    mapping (address => uint) public ballotFeeFor;
    bool public paymentEnabled = true;

    uint8 constant PAY_DEMOC = 0;
    uint8 constant PAY_BALLOT = 1;


    constructor() permissioned() public {
        payTo = msg.sender;
    }


    function payoutAll() public {
        require(payTo.call.value(address(this).balance)());
    }

    //* PAYMENT AND OWNER FUNCTIONS */

    function setPayTo(address newPayTo) only_owner() public {
        payTo = newPayTo;
    }

    function setEth(uint128[2] newFees) only_owner() public {
        democFee = newFees[PAY_DEMOC];
        ballotFee = newFees[PAY_BALLOT];
        emit SetFees([democFee, ballotFee]);
    }

    function setPaymentEnabled(bool _enabled) only_owner() public {
        paymentEnabled = _enabled;
        emit PaymentEnabled(_enabled);
    }

    function setWhitelistDemoc(address addr, bool _free) only_owner() public {
        democWhitelist[addr] = _free;
    }

    function setWhitelistBallot(address addr, bool _free) only_owner() public {
        ballotWhitelist[addr] = _free;
    }

    function setFeeFor(address addr, uint128[2] fees) only_owner() public {
        democFeeFor[addr] = fees[PAY_DEMOC];
        ballotFeeFor[addr] = fees[PAY_BALLOT];
    }
}


contract SVLightIndex is owned, canCheckOtherContracts, upgradePtr {
    SVIndexBackend public backend;
    SVIndexPaymentSettings public paymentSettings;
    SVAdminPxFactory public adminPxFactory;
    SVBBoxFactory public bbFactory;
    SvEnsEverythingPx public ensPx;

    uint8 constant PAY_DEMOC = 0;
    uint8 constant PAY_BALLOT = 1;


    uint128 constant LOW_64_BITS_OF_128 = 0xFFFFFFFFFFFFFFFF;
    uint128 constant HIGH_64_BITS_OF_128 = 0xFFFFFFFFFFFFFFFF0000000000000000;


    function getPaymentParams(uint8 paymentType) internal constant returns (bool, uint, uint) {
        if (paymentType == PAY_DEMOC) {
            return (
                paymentSettings.democWhitelist(msg.sender),
                paymentSettings.democFee(),
                paymentSettings.democFeeFor(msg.sender));
        } else if (paymentType == PAY_BALLOT) {
            return (
                paymentSettings.ballotWhitelist(msg.sender),
                paymentSettings.ballotFee(),
                paymentSettings.ballotFeeFor(msg.sender));
        } else {
            revert("paymentType parameter invalid");
        }
    }

    //* EVENTS /

    event PaymentMade(uint[2] valAndRemainder);
    event DemocAdded(bytes32 democHash, address admin);
    event BallotAdded(bytes32 democHash, uint id);

    event PaymentTooLow(uint msgValue, uint feeReq);

    //* MODIFIERS /

    modifier onlyBy(address _account) {
        if(doRequire(msg.sender == _account, ERR_FORBIDDEN)) {
            _;
        }
    }

    modifier payReq(uint8 paymentType) {
        // get our whitelist, generalFee, and fee's for particular addresses
        if (paymentSettings.paymentEnabled()){
            bool wl;
            uint genFee;
            uint feeFor;
            address payTo = paymentSettings.payTo();
            (wl, genFee, feeFor) = getPaymentParams(paymentType);
            // init v to something large in case of exploit or something
            // check whitelists - do not require payment in some cases
            if (!wl) {
                uint v = 1000 ether;
                v = feeFor;
                if (v == 0){
                    // if there's no fee for the individual user then set it to the general fee
                    v = genFee;
                }

                require(msg.value >= v, "payment too low");
                // handle payments
                uint remainder = msg.value - v;
                require(msg.sender.call.value(remainder)(), ERR_FAILED_TO_PROVIDE_CHANGE);
                require(payTo.call.value(v)(), ERR_FAILED_TO_FWD_PAYMENT);
                emit PaymentMade([v, remainder]);
            }
        }
        // do main
        _;
    }


    //* FUNCTIONS /


    // constructor
    constructor(SVIndexBackend _backend, SVIndexPaymentSettings _payBackend, SVAdminPxFactory _pxFactory, SVBBoxFactory _bbFactory, SvEnsEverythingPx _ensPx) public {
        backend = _backend;
        paymentSettings = _payBackend;
        adminPxFactory = _pxFactory;
        bbFactory = _bbFactory;
        ensPx = _ensPx;
    }

    //* UPGRADE STUFF */

    function doUpgrade(address nextSC) only_owner() not_upgraded() public {
        doUpgradeInternal(nextSC);
        require(backend.upgradeMe(nextSC));
        require(paymentSettings.upgradeMe(nextSC));
    }

    function setPaymentBackend(SVIndexPaymentSettings newSC) only_owner() public {
        paymentSettings = newSC;
    }

    function setBackend(SVIndexBackend newSC) only_owner() public {
        backend = newSC;
    }

    //* GLOBAL INFO */

    function paymentEnabled() public constant returns (bool) {
        return paymentSettings.paymentEnabled();
    }

    function democFee() public constant returns (uint) {
        return paymentSettings.democFee();
    }

    function ballotFee() public constant returns (uint) {
        return paymentSettings.ballotFee();
    }

    function nDemocs() public constant returns (uint256) {
        return backend.nDemocs();
    }

    //* DEMOCRACY FUNCTIONS - INDIVIDUAL */

    function initDemoc(string democName) payReq(PAY_DEMOC) not_upgraded() public payable returns (bytes32) {
        address admin;
        if(isContract(msg.sender)) {
            // if the caller is a contract we presume they can handle multisig themselves...
            admin = msg.sender;
        } else {
            // otherwise let's create a proxy sc for them
            SVLightAdminProxy adminPx = adminPxFactory.spawn(msg.sender, address(this));
            admin = address(adminPx);
        }

        bytes32 democHash = backend.initDemoc(democName, admin);
        emit DemocAdded(democHash, admin);

        mkDomain(democHash, admin);

        return democHash;
    }

    function getAdmin(bytes32 democHash) external constant returns (address) {
        return backend.getDAdmin(democHash);
    }

    function setAdmin(bytes32 democHash, address newAdmin) onlyBy(backend.getDAdmin(democHash)) external {
        backend.setAdmin(democHash, newAdmin);
    }

    function nBallots(bytes32 democHash) external constant returns (uint256) {
        return backend.nBallots(democHash);
    }

    function getDemocInfo(bytes32 democHash) external constant returns (string name, address admin, uint256 _nBallots) {
        return backend.getDemocInfo(democHash);
    }

    function getNthBallot(bytes32 democHash, uint256 n) external constant returns (bytes32 specHash, bytes32 extraData, address votingContract, uint64 startTime, uint64 endTime) {
        return backend.getNthBallot(democHash, n);
    }

    function democPrefixToHash(bytes13 democHashPrefix) external constant returns (bytes32) {
        return backend.democPrefixToHash(democHashPrefix);
    }

    //* ADD BALLOT TO RECORD */

    function _addBallot(bytes32 democHash, bytes32 extraData, SVLightBallotBox bb) internal returns (uint id) {
        id = backend.addBallot(democHash, extraData, bb);
        emit BallotAdded(democHash, id);
    }

    function addBallot(bytes32 democHash, bytes32 extraData, SVLightBallotBox bb)
                      onlyBy(backend.getDAdmin(democHash))
                      payReq(PAY_BALLOT)
                      external payable
                      returns (uint) {
        return _addBallot(democHash, extraData, bb);
    }

    function deployBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, uint128 packedTimes, uint16 _submissionBits)
                          onlyBy(backend.getDAdmin(democHash))
                          payReq(PAY_BALLOT)
                          external payable
                          returns (uint) {
        SVLightBallotBox bb = bbFactory.spawn(
            specHash,
            // to unpack times - the first 64 bits are start time, second 64 bits are end time
            uint64(packedTimes >> 64),
            uint64(packedTimes),
            _submissionBits,
            msg.sender);
        return _addBallot(democHash, extraData, bb);
    }


    // sv ens domains
    function mkDomain(bytes32 democHash, address admin) internal {
        // create domain for admin!
        // truncate the democHash to 13 bytes (which is the most that's safely convertable to a decimal string
        // without going over 32 chars), then convert to uint, then uint to string (as bytes32)
        bytes13 democPrefix = bytes13(democHash);
        bytes32 democPrefixIntStr = StringLib.uintToBytes(uint(democPrefix));
        // although the address doesn't exist, it gives us something to lookup I suppose.
        ensPx.regNameWOwner(b32ToStr(democPrefixIntStr), address(democPrefix), admin);
    }


    // utils
    function max(uint64 a, uint64 b) pure internal returns(uint64) {
        if (a > b) {
            return a;
        }
        return b;
    }


    function b32ToStr(bytes32 b32) pure internal returns(string) {
        uint i;
        // lets check the length first
        for (i = 0; i < 32; i++) {
            // the output from StringLib is a bytes32 and anything unfilled will be \x00
            if (b32[i] == byte(0)) {
                // if we hit a 0 byte we're done, so let's break
                break;
            }
        }

        bytes memory bs = new bytes(i);
        for(uint j = 0; j < i; j++) {
            bs[j] = b32[j];
        }

        return string(bs);
    }
}


// contract DeploySvIx {
//     event Deployed(address ix, address onDemoc, address onBallot);

//     function DeploySvIx(SVIndexBackend _backend, SVAdminPxFactory _pxFactory, SVBBoxFactory _bbFactory, SvEnsEverythingPx _ensPx) public {
//         SvlIxOnBallotHandler onBallot = new SvlIxOnBallotHandler();
//         SvlIxOnDemocHandler onDemoc = new SvlIxOnDemocHandler(_ensPx);

//         SVLightIndex ix = new SVLightIndex(_backend, _pxFactory, _bbFactory, onDemoc, onBallot);

//         onBallot.setPermissions(address(ix), true);
//         onBallot.doLockdown();
//         onDemoc.setPermissions(address(ix), true);
//         onDemoc.doLockdown();

//         emit Deployed(address(ix), address(onDemoc), address(onBallot));
//         selfdestruct(msg.sender);
//     }
// }
