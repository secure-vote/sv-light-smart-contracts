pragma solidity ^0.4.23;


//
// The Index by which democracies and ballots are tracked (and optionally deployed).
// Author: Max Kaye <max@secure.vote>
// License: MIT
// version: v1.2.0 [WIP]
//


import { SVLightBallotBox } from "./SVLightBallotBox.sol";
import { SVLightAdminProxy } from "./SVLightAdminProxy.sol";
import { canCheckOtherContracts, permissioned, hasAdmins, owned, upgradePtr, base58EnsUtils } from "./SVCommon.sol";
import { StringLib } from "../libs/StringLib.sol";
import { Base32Lib } from "../libs/Base32Lib.sol";
import { SvEnsEverythingPx } from "../../ensSCs/contracts/SvEnsEverythingPx.sol";
import "./IndexInterface.sol";


contract SVAdminPxFactory {
    function spawn(bytes32 democHash, address initAdmin, address fwdTo) external returns (SVLightAdminProxy px) {
        px = new SVLightAdminProxy(democHash, initAdmin, fwdTo);
    }
}


contract SVBBoxFactory {
    function spawn(bytes32 _specHash, uint128 packedTimes, uint16 _submissionBits, IxIface ix, address admin) external returns (SVLightBallotBox bb) {
        bb = new SVLightBallotBox(_specHash, packedTimes, _submissionBits, ix);
        bb.setOwner(admin);
    }
}


contract SVIndexBackend is IxBackendIface, permissioned {
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

    struct BallotRef {
        bytes32 democHash;
        uint ballotId;
    }

    mapping (bytes32 => Democ) public democs;
    BallotRef[] public ballotList;

    mapping (bytes13 => bytes32) public democPrefixToHash;
    bytes32[] public democList;

    //* GLOBAL INFO */

    function nDemocs() external constant returns (uint) {
        return democList.length;
    }

    function nBallotsGlobal() external constant returns (uint) {
        return ballotList.length;
    }

    //* DEMOCRACY FUNCTIONS - INDIVIDUAL */

    function initDemoc(string democName) only_editors() external returns (bytes32 democHash) {
        // generating the democHash in this way guarentees it'll be unique/hard-to-brute-force
        // (particularly because `this` and prevBlockHash are part of the hash)
        democHash = keccak256(democName, democList.length, blockhash(block.number-1), this);
        democList.push(democHash);
        democs[democHash].name = democName;
        require(democPrefixToHash[bytes13(democHash)] == bytes32(0), "democ prefix exists");
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

    function getBallotAddr(bytes32 democHash, uint n) external constant returns (address) {
        return address(democs[democHash].ballots[n].bb);
    }

    function getBallotBox(bytes32 democHash, uint id) external constant returns (SVLightBallotBox bb) {
        bb = democs[democHash].ballots[id].bb;
    }

    function getDemocHash(bytes13 prefix) external constant returns (bytes32) {
        return democPrefixToHash[prefix];
    }

    //* ADD BALLOT TO RECORD */

    function _commitBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, SVLightBallotBox bb, uint64 startTs, uint64 endTs) internal returns (uint ballotId) {
        ballotId = democs[democHash].ballots.length;
        democs[democHash].ballots.push(Ballot(specHash, extraData, bb, startTs, endTs));
        ballotList.push(BallotRef(democHash, ballotId));
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


contract SVIndexPaymentSettings is IxPaymentsSettingsIface, permissioned {
    event PaymentEnabled(bool _feeEnabled);
    event UpgradedToPremium(bytes32 indexed democHash);
    event GrantedAccountTime(bytes32 indexed democHash, uint additionalSeconds, bytes32 ref);
    event AccountPayment(bytes32 indexed democHash, uint additionalSeconds);
    event SetCommunityBallotFee(uint amount);
    event SetBasicPricePerSecond(uint amount);
    event SetPremiumMultiplier(uint8 multiplier);
    event DowngradeToBasic(bytes32 indexed democHash);
    event UpgradeToPremium(bytes32 indexed democHash);


    struct Account {
        bool isPremium;
        uint lastPaymentTs;
        uint paidUpTill;
    }

    struct PaymentLog {
        bool _external;
        uint _seconds;
        uint _ethValue;
    }


    // payment details
    address public payTo;
    bool paymentEnabled = true;
    uint communityBallotFee = 0.016 ether; // about $10 usd on 26/4/2018
    uint basicPricePerSecond = 1.6 ether / uint(30 days); // 1.6 ether per 30 days; ~$1000/mo
    uint8 premiumMultiplier = 5;


    mapping (bytes32 => Account) accounts;
    PaymentLog[] payments;


    constructor() permissioned() public {
        payTo = msg.sender;
    }

    function() payable {
        if (gasleft() > 25000) {
            // note: allow this to fail, we have `payoutAll()` if need be.
            payTo.send(msg.value);
        }
    }

    function _modAccountBalance(bytes32 democHash, uint additionalSeconds) internal {
        uint prevPaidTill = accounts[democHash].paidUpTill;
        if (prevPaidTill < now) {
            prevPaidTill = now;
        }

        accounts[democHash].paidUpTill = prevPaidTill + additionalSeconds;
        accounts[democHash].lastPaymentTs = now;
    }

    function payForDemocracy(bytes32 democHash) external payable {
        require(msg.value > 0, "need to send some ether to make payment");

        uint additionalSeconds = msg.value / basicPricePerSecond;
        if (accounts[democHash].isPremium) {
            additionalSeconds /= premiumMultiplier;
        }

        _modAccountBalance(democHash, additionalSeconds);
        payments.push(PaymentLog(false, additionalSeconds, msg.value));
        emit AccountPayment(democHash, additionalSeconds);

        payTo.transfer(msg.value);
    }

    function accountInGoodStanding(bytes32 democHash) external constant returns (bool) {
        return accounts[democHash].paidUpTill > now;
    }

    function giveTimeToDemoc(bytes32 democHash, uint additionalSeconds, bytes32 ref) only_owner() external {
        _modAccountBalance(democHash, additionalSeconds);
        payments.push(PaymentLog(true, additionalSeconds, 0));
        emit GrantedAccountTime(democHash, additionalSeconds, ref);
    }

    function upgradeToPremium(bytes32 democHash) only_editors() external {
        require(!accounts[democHash].isPremium, "cannot upgrade to premium twice");
        accounts[democHash].isPremium = true;
        // convert basic minutes to premium minutes
        uint timeRemaining = accounts[democHash].paidUpTill - now;
        // if we have time remaning then convert it - otherwise don't need to do anything
        if (timeRemaining > 0) {
            timeRemaining /= premiumMultiplier;
            accounts[democHash].paidUpTill = now + timeRemaining;
        }
        emit UpgradedToPremium(democHash);
    }

    function downgradeToBasic(bytes32 democHash) only_editors() external {
        require(accounts[democHash].isPremium, "must be premium to downgrade");
        accounts[democHash].isPremium = false;
        // convert premium minutes to basic
        uint timeRemaining = accounts[democHash].paidUpTill - now;
        // if we have time remaining: convert it
        if (timeRemaining > 0) {
            timeRemaining *= premiumMultiplier;
            accounts[democHash].paidUpTill = now + timeRemaining;
        }
        emit DowngradeToBasic(democHash);
    }

    function payoutAll() external {
        require(payTo.call.value(address(this).balance)());
    }

    //* PAYMENT AND OWNER FUNCTIONS */

    function setPayTo(address newPayTo) only_owner() external {
        payTo = newPayTo;
    }

    function setPaymentEnabled(bool _enabled) only_owner() external {
        paymentEnabled = _enabled;
        emit PaymentEnabled(_enabled);
    }

    function setCommunityBallotFee(uint amount) only_owner() external {
        communityBallotFee = amount;
        emit SetCommunityBallotFee(amount);
    }

    function setBasicPricePerSecond(uint amount) only_owner() external {
        basicPricePerSecond = amount;
        emit SetBasicPricePerSecond(amount);
    }

    function getPremiumMultiplier(uint8 m) only_owner() external {
        premiumMultiplier = m;
        emit SetPremiumMultiplier(m);
    }

    /* Getters */

    function getPayTo() external constant returns(address) {
        return payTo;
    }

    function getPaymentEnabled() external constant returns (bool) {
        return paymentEnabled;
    }

    function getCommunityBallotFee() external constant returns(uint) {
        return communityBallotFee;
    }

    function getBasicPricePerSecond() external constant returns(uint) {
        return basicPricePerSecond;
    }

    function getPremiumMultiplier() external constant returns (uint8) {
        return premiumMultiplier;
    }

    function getPremiumPricePerSecond() external constant returns (uint) {
        return _premiumPricePerSec();
    }

    function _premiumPricePerSec() internal constant returns (uint) {
        return uint(premiumMultiplier) * basicPricePerSecond;
    }
}


contract SVLightIndex is owned, canCheckOtherContracts, upgradePtr, IxIface {
    IxBackendIface public backend;
    IxPaymentsSettingsIface public paymentSettings;
    SVAdminPxFactory public adminPxFactory;
    SVBBoxFactory public bbFactory;
    SvEnsEverythingPx public ensPx;

    //* EVENTS /

    event PaymentMade(uint[2] valAndRemainder);
    event DemocAdded(bytes32 democHash, address admin);
    event BallotAdded(bytes32 democHash, uint id);
    // for debug
    // event Log(string message);
    // event LogB32(bytes32 b32);

    event PaymentTooLow(uint msgValue, uint feeReq);

    //* MODIFIERS /

    modifier onlyBy(address _account) {
        if(doRequire(msg.sender == _account, ERR_FORBIDDEN)) {
            _;
        }
    }

    modifier payReq(uint8 paymentType) {
        // get our whitelist, generalFee, and fee's for particular addresses
        if (paymentSettings.getPaymentEnabled()){
            revert("need to update payReq to check minutes avialable for democ");

            // require(msg.sender.call.value(remainder)(), ERR_FAILED_TO_PROVIDE_CHANGE);
            // require(paymentSettings.call.value(v)(), ERR_FAILED_TO_FWD_PAYMENT);
            // emit PaymentMade([v, remainder]);
        }
        // do main
        _;
    }


    //* FUNCTIONS /


    // constructor
    constructor(IxBackendIface _backend, IxPaymentsSettingsIface _payBackend, SVAdminPxFactory _pxFactory, SVBBoxFactory _bbFactory, SvEnsEverythingPx _ensPx) public {
        backend = _backend;
        paymentSettings = _payBackend;
        adminPxFactory = _pxFactory;
        bbFactory = _bbFactory;
        ensPx = _ensPx;
    }

    //* UPGRADE STUFF */

    function doUpgrade(address nextSC) only_owner() not_upgraded() external {
        doUpgradeInternal(nextSC);
        require(backend.upgradeMe(nextSC));
        require(paymentSettings.upgradeMe(nextSC));
        ensPx.addAdmin(nextSC);
    }

    // for emergencies
    function setPaymentBackend(IxPaymentsSettingsIface newSC) only_owner() external {
        paymentSettings = newSC;
    }

    // for emergencies
    function setBackend(IxBackendIface newSC) only_owner() external {
        backend = newSC;
    }

    //* GLOBAL INFO */

    function getPaymentEnabled() public constant returns (bool) {
        return paymentSettings.getPaymentEnabled();
    }

    function nDemocs() public constant returns (uint256) {
        return backend.nDemocs();
    }

    //* DEMOCRACY FUNCTIONS - INDIVIDUAL */

    // todo: handling payments for creating a democ
    function initDemoc(string democName) not_upgraded() public payable returns (bytes32) {
        // address admin;
        // if(isContract(msg.sender)) {
        //     // if the caller is a contract we presume they can handle multisig themselves...
        //     admin = msg.sender;
        // } else {
        //     // otherwise let's create a proxy sc for them
        //     SVLightAdminProxy adminPx = adminPxFactory.spawn(msg.sender, address(this));
        //     admin = address(adminPx);
        // }

        bytes32 democHash = backend.initDemoc(democName);

        SVLightAdminProxy adminPx = adminPxFactory.spawn(democHash, msg.sender, address(this));
        address admin = address(adminPx);
        backend.setAdmin(democHash, admin);

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

    function getBallotAddr(bytes32 democHash, uint n) external constant returns (address) {
        return backend.getBallotAddr(democHash, n);
    }

    function getDemocHash(bytes13 prefix) external constant returns (bytes32) {
        return backend.getDemocHash(prefix);
    }

    function payForDemocracy(bytes32 democHash) external payable {
        paymentSettings.payForDemocracy.value(msg.value)(democHash);
    }

    function getPayTo() external returns (address) {
        return paymentSettings.getPayTo();
    }

    function getCommunityBallotFee() external returns (uint) {
        return paymentSettings.getCommunityBallotFee();
    }

    function accountInGoodStanding(bytes32 democHash) external constant returns (bool) {
        return paymentSettings.accountInGoodStanding(democHash);
    }

    //* ADD BALLOT TO RECORD */

    function _addBallot(bytes32 democHash, bytes32 extraData, SVLightBallotBox bb) internal returns (uint id) {
        id = backend.addBallot(democHash, extraData, bb);
        emit BallotAdded(democHash, id);
    }

    function addBallot(bytes32 democHash, bytes32 extraData, SVLightBallotBox bb)
                      only_owner()
                      external
                      returns (uint) {
        return _addBallot(democHash, extraData, bb);
    }

    function deployBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, uint128 packedTimes, uint16 _submissionBits)
                          onlyBy(backend.getDAdmin(democHash))
                          // todo: handling payments here
                          external payable
                          returns (uint) {
        SVLightBallotBox bb = bbFactory.spawn(
            specHash,
            packedTimes,
            _submissionBits,
            this,
            msg.sender);
        return _addBallot(democHash, extraData, bb);
    }


    // sv ens domains
    function mkDomain(bytes32 democHash, address adminSc) internal {
        // create domain for admin!
        // truncate the democHash to 13 bytes (which is the most that's safely convertable to a decimal string
        // without going over 32 chars), then convert to uint, then uint to string (as bytes32)
        bytes13 democPrefix = bytes13(democHash);
        // bytes32 democPrefixIntStr = StringLib.uintToBytes(uint(democPrefix));
        // // although the address doesn't exist, it gives us something to lookup I suppose.
        // ensPx.regName(b32ToStr(democPrefixIntStr), address(democPrefix), admin);
        bytes memory prefixB32 = Base32Lib.toBase32(b13ToBytes(democPrefix));
        bytes32 node = ensPx.regName(string(prefixB32), adminSc);
    }


    // TODO: move these utils to a library before go-live


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


    function b13ToBytes(bytes13 b13) pure internal returns(bytes) {
        bytes memory bs = new bytes(13);
        for (uint i = 0; i < 13; i++) {
            bs[i] = b13[i];
        }
        return bs;
    }
}
