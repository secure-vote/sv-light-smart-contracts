pragma solidity ^0.4.21;


//
// The Index by which democracies and ballots are tracked (and optionally deployed).
// Author: Max Kaye <max@secure.vote>
// License: MIT
// version: v1.2.0 [WIP]
//


import { SVLightBallotBox } from "./SVLightBallotBox.sol";
import { SVLightAdminProxy } from "./SVLightAdminProxy.sol";
import { canCheckOtherContracts, permissioned, hasAdmins, owned, upgradePtr } from "./SVCommon.sol";



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
    bytes32[] public democList;

    //* GLOBAL INFO */

    function nDemocs() external constant returns (uint256) {
        return democList.length;
    }

    //* DEMOCRACY FUNCTIONS - INDIVIDUAL */

    function initDemoc(string democName, address admin) only_editors() external returns (bytes32 democHash) {
        // generating the democHash in this way guarentees it'll be unique (particularly because `this` is part of the hash)
        democHash = keccak256(democName, admin, democList.length, this);
        democList.push(democHash);
        democs[democHash].name = democName;
        democs[democHash].admin = admin;
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

    function deployBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, uint64 _startTs, uint64 endTs, uint16 _submissionBits, SVBBoxFactory bbF, address admin) only_editors() external returns (uint id) {
        // the start time is max(startTime, block.timestamp) to avoid a DoS whereby a malicious electioneer could disenfranchise
        // token holders who have recently acquired tokens.
        SVLightBallotBox bb = bbF.spawn(specHash, _startTs, endTs, _submissionBits, admin);
        id = _commitBallot(democHash, specHash, extraData, bb, bb.startTime(), endTs);
    }

    // utils
    function max(uint64 a, uint64 b) pure internal returns(uint64) {
        if (a > b) {
            return a;
        }
        return b;
    }
}


contract SVLightIndex is owned, canCheckOtherContracts, upgradePtr {
    SVIndexBackend public backend;
    SVAdminPxFactory public adminPxFactory;
    SVBBoxFactory public bbFactory;

    // addresses that do not have to pay for democs
    mapping (address => bool) public democWhitelist;
    // democs that do not have to pay for issues
    mapping (address => bool) public ballotWhitelist;

    // payment details
    address public payTo;
    // uint128's used because they account for amounts up to 3.4e38 wei or 3.4e20 ether
    uint public democFee = 0.125 ether; // 0.125 ether; about $50 at 10 Apr 2018
    mapping (address => uint) democFeeFor;
    uint public ballotFee = 0.025 ether; // 0.025 ether; about $10 at 10 Apr 2018
    mapping (address => uint) ballotFeeFor;
    bool public paymentEnabled = true;

    uint8 constant PAY_DEMOC = 0;
    uint8 constant PAY_BALLOT = 1;

    function getPaymentParams(uint8 paymentType) internal constant returns (bool, uint, uint) {
        if (paymentType == PAY_DEMOC) {
            return (democWhitelist[msg.sender], democFee, democFeeFor[msg.sender]);
        } else if (paymentType == PAY_BALLOT) {
            return (ballotWhitelist[msg.sender], ballotFee, ballotFeeFor[msg.sender]);
        } else {
            assert(false);
        }
    }

    //* EVENTS /

    event PaymentMade(uint[2] valAndRemainder);
    event SetFees(uint[2] _newFees);
    event PaymentEnabled(bool _feeEnabled);
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
        bool wl;
        uint genFee;
        uint feeFor;
        (wl, genFee, feeFor) = getPaymentParams(paymentType);
        // init v to something large in case of exploit or something
        uint v = 1000 ether;
        // check whitelists - do not require payment in some cases
        if (paymentEnabled && !wl) {
            v = feeFor;
            if (v == 0){
                // if there's no fee for the individual user then set it to the general fee
                v = genFee;
            }

            if (doRequire(msg.value >= v, ERR_BAD_PAYMENT)) {
                // handle payments
                uint remainder = msg.value - v;
                payTo.transfer(v); // .transfer so it throws on failure
                if (!msg.sender.send(remainder)){
                    payTo.transfer(remainder);
                }
                emit PaymentMade([v, remainder]);
            } else {
                emit PaymentTooLow(msg.value, v);
                return;
            }
        }

        // do main
        _;
    }


    //* FUNCTIONS /


    // constructor
    function SVLightIndex(SVIndexBackend _backend, SVAdminPxFactory _pxFactory, SVBBoxFactory _bbFactory) public {
        payTo = msg.sender;
        backend = _backend;
        adminPxFactory = _pxFactory;
        bbFactory = _bbFactory;
    }

    //* UPGRADE STUFF */

    function doUpgrade(address nextSC) only_owner() not_upgraded() public {
        backend.upgradeMe(nextSC);
        doUpgradeInternal(nextSC);
    }

    //* GLOBAL INFO */

    function nDemocs() public constant returns (uint256) {
        return backend.nDemocs();
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

    function getNthBallot(bytes32 democHash, uint256 n) external constant returns (bytes32 specHash, bytes32 extraData, address votingContract, uint64 startTime, uint64 endTime) {
        return backend.getNthBallot(democHash, n);
    }

    //* ADD BALLOT TO RECORD */

    function addBallot(bytes32 democHash, bytes32 extraData, SVLightBallotBox bb)
                      onlyBy(backend.getDAdmin(democHash))
                      payReq(PAY_BALLOT)
                      public
                      payable
                      returns (uint id)
                      {
        id = backend.addBallot(democHash, extraData, bb);
        emit BallotAdded(democHash, id);
    }

    function deployBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, uint64 _startTs, uint64 endTs, uint16 _submissionBits)
                          onlyBy(backend.getDAdmin(democHash))
                          payReq(PAY_BALLOT)
                          public payable
                          returns (uint id) {
        id = backend.deployBallot(democHash, specHash, extraData, _startTs, endTs, _submissionBits, bbFactory, msg.sender);
        emit BallotAdded(democHash, id);
    }

    // utils
    function max(uint64 a, uint64 b) pure internal returns(uint64) {
        if (a > b) {
            return a;
        }
        return b;
    }
}
