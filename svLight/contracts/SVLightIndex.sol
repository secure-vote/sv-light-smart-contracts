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
import { BallotBoxIface } from "./BallotBoxIface.sol";
import "./SVPayments.sol";


contract SVAdminPxFactory {
    function spawn(bytes32 democHash, address initAdmin, address fwdTo) external returns (SVLightAdminProxy px) {
        px = new SVLightAdminProxy(democHash, initAdmin, fwdTo);
    }
}


contract SVBBoxFactory {
    function spawn(bytes32 _specHash, uint256 packed, IxIface ix, address admin) external returns (BallotBoxIface bb) {
        bb = new SVLightBallotBox(_specHash, packed, ix);
        bb.setOwner(admin);
    }
}


contract SVIndexBackend is IxBackendIface, permissioned {
    event LowLevelNewBallot(bytes32 democHash, uint id);
    event LowLevelNewDemoc(bytes32 democHash);

    struct Ballot {
        bytes32 specHash;
        bytes32 extraData;
        BallotBoxIface bb;
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

    struct Category {
        bool deprecated;
        bytes32 name;
        bool hasParent;
        uint parent;
    }

    struct CategoriesIx {
        uint nCategories;
        mapping(uint => Category) categories;
    }

    BallotRef[] public ballotList;

    mapping (bytes32 => Democ) public democs;
    mapping (bytes32 => CategoriesIx) public democCategories;
    mapping (bytes13 => bytes32) public democPrefixToHash;
    bytes32[] public democList;

    //* GLOBAL INFO */

    function getGDemocsN() external view returns (uint) {
        return democList.length;
    }

    function getGDemoc(uint id) external view returns (bytes32) {
        return democList[id];
    }

    function getGBallotsN() external view returns (uint) {
        return ballotList.length;
    }

    function getGBallot(uint id) external view returns (bytes32 democHash, uint ballotId) {
        return (ballotList[id].democHash, ballotList[id].ballotId);
    }

    //* DEMOCRACY ADMIN FUNCTIONS */

    function dInit(string democName) only_editors() external returns (bytes32 democHash) {
        // generating the democHash in this way guarentees it'll be unique/hard-to-brute-force
        // (particularly because `this` and prevBlockHash are part of the hash)
        democHash = keccak256(democName, democList.length, blockhash(block.number-1), this);
        democList.push(democHash);
        democs[democHash].name = democName;
        require(democPrefixToHash[bytes13(democHash)] == bytes32(0), "democ prefix exists");
        democPrefixToHash[bytes13(democHash)] = democHash;
        emit LowLevelNewDemoc(democHash);
    }

    function setDAdmin(bytes32 democHash, address newAdmin) only_editors() external {
        democs[democHash].admin = newAdmin;
    }

    function dAddCategory(bytes32 democHash, bytes32 categoryName, bool hasParent, uint parent) only_editors() external returns (uint) {
        uint catId = democCategories[democHash].nCategories;
        democCategories[democHash].categories[catId].name = categoryName;
        if (hasParent) {
            democCategories[democHash].categories[catId].hasParent = true;
            democCategories[democHash].categories[catId].parent = parent;
        }
        democCategories[democHash].nCategories += 1;
        return catId;
    }

    function dDeprecateCategory(bytes32 democHash, uint categoryId) only_editors() external {
        democCategories[democHash].categories[categoryId].deprecated = true;
    }

    /* democ getters */

    function getDHash(bytes13 prefix) external view returns (bytes32) {
        return democPrefixToHash[prefix];
    }

    function getDInfo(bytes32 democHash) external view returns (string name, address admin, uint256 nBallots) {
        return (democs[democHash].name, democs[democHash].admin, democs[democHash].ballots.length);
    }

    function getDName(bytes32 democHash) external view returns (string) {
        return democs[democHash].name;
    }

    function getDAdmin(bytes32 democHash) external view returns (address) {
        return democs[democHash].admin;
    }

    function getDBallotsN(bytes32 democHash) external view returns (uint256) {
        return democs[democHash].ballots.length;
    }

    function getDBallot(bytes32 democHash, uint256 n) external view returns (bytes32 specHash, bytes32 extraData, BallotBoxIface bb, uint64 startTime, uint64 endTime) {
        Ballot memory b = democs[democHash].ballots[n];
        return (b.specHash, b.extraData, b.bb, b.startTs, b.endTs);
    }

    function getDBallotAddr(bytes32 democHash, uint n) external view returns (address) {
        return address(democs[democHash].ballots[n].bb);
    }

    function getDBallotBox(bytes32 democHash, uint id) external view returns (BallotBoxIface bb) {
        bb = democs[democHash].ballots[id].bb;
    }

    function getDCategoriesN(bytes32 democHash) external view returns (uint) {
        return democCategories[democHash].nCategories;
    }

    function getDCategory(bytes32 democHash, uint categoryId) external view returns (bool deprecated, bytes32 catName, bool hasParent, uint256 parent) {
        deprecated = democCategories[democHash].categories[categoryId].deprecated;
        catName = democCategories[democHash].categories[categoryId].name;
        hasParent = democCategories[democHash].categories[categoryId].hasParent;
        parent = democCategories[democHash].categories[categoryId].parent;
    }

    //* ADD BALLOT TO RECORD */

    function _commitBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, BallotBoxIface bb, uint64 startTs, uint64 endTs) internal returns (uint ballotId) {
        ballotId = democs[democHash].ballots.length;
        democs[democHash].ballots.push(Ballot(specHash, extraData, bb, startTs, endTs));
        ballotList.push(BallotRef(democHash, ballotId));
        emit LowLevelNewBallot(democHash, ballotId);
    }

    function dAddBallot(bytes32 democHash, bytes32 extraData, BallotBoxIface bb) only_editors() external returns (uint ballotId) {
        bytes32 specHash = bb.getSpecHash();
        uint64 startTs = bb.getStartTime();
        uint64 endTs = bb.getEndTime();
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


contract SVLightIndex is owned, canCheckOtherContracts, upgradePtr, IxIface {
    IxBackendIface public backend;
    IxPaymentsIface public payments;
    SVAdminPxFactory public adminPxFactory;
    SVBBoxFactory public bbFactory;
    SvEnsEverythingPx public ensPx;

    uint256 constant _version = 2;

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

    modifier onlyDemocAdmin(bytes32 democHash) {
        require(msg.sender == backend.getDAdmin(democHash), "403: Forbidden. Not democ admin");
        _;
    }

    //* FUNCTIONS *//

    // constructor
    constructor(IxBackendIface _b, IxPaymentsIface _pay, SVAdminPxFactory _pxF, SVBBoxFactory _bbF, SvEnsEverythingPx _ensPx) public {
        backend = _b;
        payments = _pay;
        adminPxFactory = _pxF;
        bbFactory = _bbF;
        ensPx = _ensPx;
    }

    //* UPGRADE STUFF */

    function doUpgrade(address nextSC) only_owner() not_upgraded() external {
        doUpgradeInternal(nextSC);
        require(backend.upgradeMe(nextSC));
        require(payments.upgradeMe(nextSC));
        ensPx.addAdmin(nextSC);
    }

    // for emergencies
    function setPaymentBackend(IxPaymentsIface newSC) only_owner() external {
        payments = newSC;
    }

    // for emergencies
    function setBackend(IxBackendIface newSC) only_owner() external {
        backend = newSC;
    }

    //* GLOBAL INFO */

    function getVersion() external view returns (uint256) {
        return _version;
    }

    function getPaymentEnabled() external view returns (bool) {
        return payments.getPaymentEnabled();
    }

    function getPayTo() external returns (address) {
        return payments.getPayTo();
    }

    function getCommunityBallotCentsPrice() external returns (uint) {
        return payments.getCommunityBallotCentsPrice();
    }

    function getGDemocsN() external view returns (uint256) {
        return backend.getGDemocsN();
    }

    function getGDemoc(uint256 n) external view returns (bytes32) {
        return backend.getGDemoc(n);
    }

    //* DEMOCRACY FUNCTIONS - INDIVIDUAL */

    // todo: handling payments for creating a democ
    function dInit(string democName) not_upgraded() external payable returns (bytes32) {
        // address admin;
        // if(isContract(msg.sender)) {
        //     // if the caller is a contract we presume they can handle multisig themselves...
        //     admin = msg.sender;
        // } else {
        //     // otherwise let's create a proxy sc for them
        //     SVLightAdminProxy adminPx = adminPxFactory.spawn(msg.sender, address(this));
        //     admin = address(adminPx);
        // }

        bytes32 democHash = backend.dInit(democName);

        SVLightAdminProxy adminPx = adminPxFactory.spawn(democHash, msg.sender, address(this));
        address admin = address(adminPx);
        backend.setDAdmin(democHash, admin);

        emit DemocAdded(democHash, admin);

        mkDomain(democHash, admin);

        payments.payForDemocracy.value(msg.value)(democHash);

        return democHash;
    }

    // democ payments
    function payForDemocracy(bytes32 democHash) external payable {
        payments.payForDemocracy.value(msg.value)(democHash);
    }

    function accountInGoodStanding(bytes32 democHash) external view returns (bool) {
        return payments.accountInGoodStanding(democHash);
    }

    // admin methods
    function setDAdmin(bytes32 democHash, address newAdmin) onlyDemocAdmin(democHash) external {
        backend.setDAdmin(democHash, newAdmin);
    }

    function dAddCategory(bytes32 democHash, bytes32 categoryName, bool hasParent, uint parent) onlyDemocAdmin(democHash) external returns (uint) {
        return backend.dAddCategory(democHash, categoryName, hasParent, parent);
    }

    function dDeprecateCategory(bytes32 democHash, uint categoryId) onlyDemocAdmin(democHash) external {
        backend.dDeprecateCategory(democHash, categoryId);
    }

    // getters for democs
    function getDAdmin(bytes32 democHash) external view returns (address) {
        return backend.getDAdmin(democHash);
    }

    function getDBallotsN(bytes32 democHash) external view returns (uint256) {
        return backend.getDBallotsN(democHash);
    }

    function getDBallot(bytes32 democHash, uint256 n) external view returns (bytes32 specHash, bytes32 extraData, BallotBoxIface bb, uint64 startTime, uint64 endTime) {
        return backend.getDBallot(democHash, n);
    }

    function getDInfo(bytes32 democHash) external view returns (string name, address admin, uint256 _nBallots) {
        return backend.getDInfo(democHash);
    }

    function getDName(bytes32 democHash) external view returns (string) {
        return backend.getDName(democHash);
    }

    function getDBallotAddr(bytes32 democHash, uint n) external view returns (address) {
        return backend.getDBallotAddr(democHash, n);
    }

    function getDBallotBox(bytes32 democHash, uint n) external view returns (BallotBoxIface) {
        return backend.getDBallotBox(democHash, n);
    }

    function getDHash(bytes13 prefix) external view returns (bytes32) {
        return backend.getDHash(prefix);
    }

    function getDCategoriesN(bytes32 democHash) external view returns (uint) {
        return backend.getDCategoriesN(democHash);
    }

    function getDCategory(bytes32 democHash, uint categoryId) external view returns (bool, bytes32, bool, uint) {
        return backend.getDCategory(democHash, categoryId);
    }

    //* ADD BALLOT TO RECORD */

    function _addBallot(bytes32 democHash, bytes32 extraData, BallotBoxIface bb) internal returns (uint id) {
        id = backend.dAddBallot(democHash, extraData, bb);
        emit BallotAdded(democHash, id);
    }

    function dAddBallot(bytes32 democHash, bytes32 extraData, BallotBoxIface bb)
                      only_owner()
                      external
                      returns (uint) {
        return _addBallot(democHash, extraData, bb);
    }

    function dDeployBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, uint256 packed)
                          onlyBy(backend.getDAdmin(democHash))
                          // todo: handling payments here
                          external payable
                          returns (uint) {
        BallotBoxIface bb = bbFactory.spawn(
            specHash,
            packed,
            this,
            msg.sender);
        return _addBallot(democHash, extraData, bb);
    }


    // sv ens domains
    function mkDomain(bytes32 democHash, address adminSc) internal returns (bytes32 node) {
        // create domain for admin!
        // truncate the democHash to 13 bytes (which is the most that's safely convertable to a decimal string
        // without going over 32 chars), then convert to uint, then uint to string (as bytes32)
        bytes13 democPrefix = bytes13(democHash);
        // bytes32 democPrefixIntStr = StringLib.uintToBytes(uint(democPrefix));
        // // although the address doesn't exist, it gives us something to lookup I suppose.
        // ensPx.regName(b32ToStr(democPrefixIntStr), address(democPrefix), admin);
        bytes memory prefixB32 = Base32Lib.toBase32(b13ToBytes(democPrefix));
        node = ensPx.regName(string(prefixB32), adminSc);
    }


    // TODO: move these utils to a library before go-live


    // utils
    function maxU64(uint64 a, uint64 b) pure internal returns(uint64) {
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
