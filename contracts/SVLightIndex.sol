pragma solidity ^0.4.24;


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
import { SvEnsEverythingPx } from "../ens/SvEnsEverythingPx.sol";
import "./IndexInterface.sol";
import { BallotBoxIface } from "./BallotBoxIface.sol";
import "./SVPayments.sol";
import "./EnsOwnerProxy.sol";
import { BPackedUtils } from "../libs/BPackedUtils.sol";


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
        uint256 creationTs;
    }

    struct Democ {
        address erc20;
        address admin;
        Ballot[] ballots;
        uint256[] officialBallots;  // the IDs of official ballots
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
    mapping (address => bytes32[]) public erc20ToDemoc;
    bytes32[] public democList;

    //* GLOBAL INFO */

    function getGDemocsN() external view returns (uint) {
        return democList.length;
    }

    function getGDemoc(uint id) external view returns (bytes32) {
        return democList[id];
    }

    function getGBallot(uint id) external view returns (bytes32 democHash, uint ballotId) {
        return (ballotList[id].democHash, ballotList[id].ballotId);
    }

    function getGBallotsN() external view returns (uint) {
        return ballotList.length;
    }

    function getGErc20ToDemocs(address erc20) external view returns (bytes32[] democHashes) {
        return erc20ToDemoc[erc20];
    }

    //* DEMOCRACY ADMIN FUNCTIONS */

    function dInit(address defaultErc20) only_editors() external returns (bytes32 democHash) {
        // generating the democHash in this way guarentees it'll be unique/hard-to-brute-force
        // (particularly because `this` and prevBlockHash are part of the hash)
        democHash = keccak256(abi.encodePacked(democList.length, blockhash(block.number-1), this, msg.sender, defaultErc20));
        democList.push(democHash);
        democs[democHash].erc20 = defaultErc20;
        require(democPrefixToHash[bytes13(democHash)] == bytes32(0), "democ prefix exists");
        democPrefixToHash[bytes13(democHash)] = democHash;
        erc20ToDemoc[defaultErc20].push(democHash);
        emit LowLevelNewDemoc(democHash);
    }

    function setDAdmin(bytes32 democHash, address newAdmin) only_editors() external {
        democs[democHash].admin = newAdmin;
    }

    function setDErc20(bytes32 democHash, address newErc20) only_editors() external {
        democs[democHash].erc20 = newErc20;
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

    function getDInfo(bytes32 democHash) external view returns (address erc20, address admin, uint256 nBallots) {
        return (democs[democHash].erc20, democs[democHash].admin, democs[democHash].ballots.length);
    }

    function getDErc20(bytes32 democHash) external view returns (address) {
        return democs[democHash].erc20;
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

    function getDBallotCreationTs(bytes32 democHash, uint n) external view returns (uint256) {
        return democs[democHash].ballots[n].creationTs;
    }

    function getDOfficialBallotsN(bytes32 democHash) external view returns (uint256) {
        return democs[democHash].officialBallots.length;
    }

    function getDOfficialBallotID(bytes32 democHash, uint256 officialN) external returns (uint256) {
        return democs[democHash].officialBallots[officialN];
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
        democs[democHash].ballots.push(Ballot(specHash, extraData, bb, startTs, endTs, now));

        if (bb.isOfficial()) {
            democs[democHash].officialBallots.push(ballotId);
        }

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
    EnsOwnerProxy public ensOwnerPx;

    uint256 constant _version = 2;

    bool txMutex = false;

    //* EVENTS /

    event PaymentMade(uint[2] valAndRemainder);
    event DemocAdded(bytes32 democHash, address admin);
    event BallotAdded(bytes32 democHash, uint id);
    // for debug
    // event Log(string message);
    // event LogB32(bytes32 b32);

    //* MODIFIERS /

    modifier onlyBy(address _account) {
        require(msg.sender == _account, ERR_FORBIDDEN);
        _;
    }

    modifier onlyDemocAdmin(bytes32 democHash) {
        require(msg.sender == backend.getDAdmin(democHash), "403: Forbidden. Not democ admin");
        _;
    }

    //* FUNCTIONS *//

    // constructor
    constructor( IxBackendIface _b
               , IxPaymentsIface _pay
               , SVAdminPxFactory _pxF
               , SVBBoxFactory _bbF
               , SvEnsEverythingPx _ensPx
               , EnsOwnerProxy _ensOwnerPx
               ) public {
        backend = _b;
        payments = _pay;
        adminPxFactory = _pxF;
        bbFactory = _bbF;
        ensPx = _ensPx;
        ensOwnerPx = _ensOwnerPx;
    }

    //* UPGRADE STUFF */

    function doUpgrade(address nextSC) only_owner() not_upgraded() external {
        doUpgradeInternal(nextSC);
        require(backend.upgradeMe(nextSC));
        require(payments.upgradeMe(nextSC));
        ensPx.upgradeMe(nextSC);
        ensOwnerPx.setAddr(nextSC);
        ensOwnerPx.upgradeMeAdmin(nextSC);
    }

    /* FOR EMERGENCIES */

    function emergencySetPaymentBackend(IxPaymentsIface newSC) only_owner() external {
        payments = newSC;
    }

    function emergencySetBackend(IxBackendIface newSC) only_owner() external {
        backend = newSC;
    }

    function emergencySetAdmin(bytes32 democHash, address newAdmin) only_owner() external {
        backend.setDAdmin(democHash, newAdmin);
    }

    //* GLOBAL INFO */

    function getVersion() external view returns (uint256) {
        return _version;
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

    function getGErc20ToDemocs(address erc20) external view returns (bytes32[] democHashes) {
        return backend.getGErc20ToDemocs(erc20);
    }

    //* DEMOCRACY FUNCTIONS - INDIVIDUAL */

    function dInit(address defaultErc20) not_upgraded() external payable returns (bytes32) {
        bytes32 democHash = backend.dInit(defaultErc20);

        SVLightAdminProxy adminPx = adminPxFactory.spawn(democHash, msg.sender, address(this));
        address admin = address(adminPx);
        backend.setDAdmin(democHash, admin);
        mkDomain(democHash, admin);

        payments.payForDemocracy.value(msg.value)(democHash);

        emit DemocAdded(democHash, admin);
        return democHash;
    }

    // democ payments
    function payForDemocracy(bytes32 democHash) external payable {
        payments.payForDemocracy.value(msg.value)(democHash);
    }

    function accountInGoodStanding(bytes32 democHash) external view returns (bool) {
        return payments.accountInGoodStanding(democHash);
    }

    function accountPremiumAndInGoodStanding(bytes32 democHash) external view returns (bool) {
        return payments.accountInGoodStanding(democHash) && payments.getPremiumStatus(democHash);
    }

    // admin methods

    // disable `setDAdmin` bc users should not be able to migrate away from the
    // admin smart contract
    // function setDAdmin(bytes32 democHash, address newAdmin) onlyDemocAdmin(democHash) external {
    //     backend.setDAdmin(democHash, newAdmin);
    // }

    function setDErc20(bytes32 democHash, address newErc20) onlyDemocAdmin(democHash) external {
        backend.setDErc20(democHash, newErc20);
    }

    function dAddCategory(bytes32 democHash, bytes32 categoryName, bool hasParent, uint parent) onlyDemocAdmin(democHash) external returns (uint) {
        return backend.dAddCategory(democHash, categoryName, hasParent, parent);
    }

    function dDeprecateCategory(bytes32 democHash, uint categoryId) onlyDemocAdmin(democHash) external {
        backend.dDeprecateCategory(democHash, categoryId);
    }

    function dUpgradeToPremium(bytes32 democHash) onlyDemocAdmin(democHash) external {
        payments.upgradeToPremium(democHash);
    }

    function dDowngradeToBasic(bytes32 democHash) onlyDemocAdmin(democHash) external {
        payments.downgradeToBasic(democHash);
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

    function getDInfo(bytes32 democHash) external view returns (address erc20, address admin, uint256 _nBallots) {
        return backend.getDInfo(democHash);
    }

    function getDErc20(bytes32 democHash) external view returns (address erc20) {
        return backend.getDErc20(democHash);
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

    // manually add a ballot - only the owner can call this
    function dAddBallot(bytes32 democHash, bytes32 extraData, BallotBoxIface bb)
                      only_owner()
                      external
                      returns (uint) {
        return _addBallot(democHash, extraData, bb);
    }

    function _deployBallotChecks(bytes32 democHash, BallotBoxIface bb) internal view {
        uint256 endTime = uint256(bb.getEndTime());
        // end time must be in future
        require(endTime > now, "ballot must end in the future");
        require(bb.isTesting() == false, "ballot cannot be in testing mode");

        // if the ballot is marked as official require the democracy is paid up to
        // some relative amount - exclude NFP accounts from this check
        if (bb.isOfficial()) {
            uint secsLeft = payments.getSecondsRemaining(democHash);
            // must be positive due to ending in future check
            uint256 secsToEndTime = endTime - now;
            // require ballots end no more than twice the time left on the democracy
            require(secsLeft * 2 > secsToEndTime, "democracy not paid up enough for ballot");
        }
    }

    function _basicBallotLimitOperations(bytes32 democHash, BallotBoxIface bb) internal {
        // if we're an official ballot and the democ is basic, ensure the democ
        // isn't over the ballots/mo limit
        if (bb.isOfficial() && payments.getPremiumStatus(democHash) == false) {
            uint nBallotsAllowed = payments.getBasicBallotsPer30Days();
            uint nBallotsOfficial = backend.getDOfficialBallotsN(democHash);

            // if the democ has less than nBallotsAllowed then it's guarenteed to be okay
            if (nBallotsAllowed > nBallotsOfficial) {
                return;
            }

            // we want to check the creation timestamp of the nth most recent ballot
            // where n is the # of ballots allowed per month. Note: there isn't an off
            // by 1 error here because if 1 ballots were allowed per month then we'd want
            // to look at the most recent ballot, so nBallotsOfficial-1 in this case.
            // similarly, if X ballots were allowed per month we want to look at
            // nBallotsOfficial-X. There would thus be (X-1) ballots that are _more_
            // recent than the one we're looking for.
            uint earlyBallotId = backend.getDOfficialBallotID(democHash, nBallotsOfficial - nBallotsAllowed);
            uint earlyBallotTs = backend.getDBallotCreationTs(democHash, earlyBallotId);

            // if the earlyBallot was created more than 30 days in the past we're okay
            if (earlyBallotTs < now - 30 days) {
                return;
            }

            // at this point it may be the case that we shouldn't allow the ballot
            // to be created. (It's an official ballot for a basic tier democracy
            // where the Nth most recent ballot was created within the last 30 days.)
            // We should now check for payment
            uint extraBallotFee = payments.getBasicExtraBallotFeeWei();
            require(msg.value >= extraBallotFee, "extra ballots at the basic tier require payment");

            // now that we know they've paid the fee, we should send Eth to `payTo`
            // and return the remainder.
            uint remainder = msg.value - extraBallotFee;
            safeSend(address(payments), extraBallotFee);
            safeSend(msg.sender, remainder);

            return;
        }
    }

    function dDeployBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, uint256 packed)
                          onlyDemocAdmin(democHash)
                          // todo: handling payments here
                          external payable
                          returns (uint) {

        BallotBoxIface bb = bbFactory.spawn(
            specHash,
            packed,
            this,
            msg.sender);

        _basicBallotLimitOperations(democHash, bb);
        _deployBallotChecks(democHash, bb);

        return _addBallot(democHash, extraData, bb);
    }


    // sv ens domains
    function mkDomain(bytes32 democHash, address adminSc) internal returns (bytes32 node) {
        // create domain for admin SC!
        // truncate the democHash to 13 bytes and then to base32 (alphabet borrowed from bech32 spec)
        bytes13 democPrefix = bytes13(democHash);
        bytes memory prefixB32 = Base32Lib.toBase32(b13ToBytes(democPrefix));
        // set owner to 0 so it's well known the domain can't be redirected
        node = ensPx.regNameWOwner(string(prefixB32), adminSc, address(0));
    }

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


    // we want to be able to call outside contracts (e.g. the admin proxy contract)
    // but reentrency is bad, so here's a mutex.
    function safeSend(address toAddr, uint amount) internal {
        require(txMutex == false, "Guard is active");
        txMutex = true;
        require(toAddr.call.value(amount)(), "safeSend failed");
        txMutex = false;
    }
}
