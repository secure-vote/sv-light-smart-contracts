pragma solidity ^0.4.24;


//
// The Index by which democracies and ballots are tracked (and optionally deployed).
// Author: Max Kaye <max@secure.vote>
// License: MIT
// version: v1.2.0 [WIP]
//


import { SVLightAdminProxy } from "./SVLightAdminProxy.sol";
import { permissioned, hasAdmins, owned, upgradePtr, payoutAll } from "./SVCommon.sol";
import { StringLib } from "../libs/StringLib.sol";
import { Base32Lib } from "../libs/Base32Lib.sol";
import { SvEnsEverythingPx } from "./SvEnsEverythingPx.sol";
import "./IndexInterface.sol";
import { BallotBoxIface } from "./BallotBoxIface.sol";
import "./SVPayments.sol";
import "./EnsOwnerProxy.sol";
import { BPackedUtils } from "./BPackedUtils.sol";
import "./BBLib.sol";
import "./BBFarm.sol";


contract SVAdminPxFactory is payoutAll {
    function spawn(bytes32 democHash, address initAdmin, address fwdTo) external returns (SVLightAdminProxy px) {
        px = new SVLightAdminProxy(democHash, initAdmin, fwdTo);
    }
}


contract ixBackendEvents {
    event NewBallot(bytes32 indexed democHash, uint ballotN);
    event NewDemoc(bytes32 democHash);
    event DemocAdminSet(bytes32 indexed democHash, address admin);
}


contract SVIndexBackend is IxBackendIface, permissioned, ixBackendEvents, payoutAll {
    struct Democ {
        address erc20;
        address admin;
        uint256[] allBallots;
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

    mapping (bytes32 => Democ) democs;
    mapping (bytes32 => CategoriesIx) democCategories;
    mapping (bytes13 => bytes32) democPrefixToHash;
    mapping (address => bytes32[]) erc20ToDemocs;
    bytes32[] democList;

    //* GLOBAL INFO */

    function getGDemocsN() external view returns (uint) {
        return democList.length;
    }

    function getGDemoc(uint id) external view returns (bytes32) {
        return democList[id];
    }

    function getGErc20ToDemocs(address erc20) external view returns (bytes32[] democHashes) {
        return erc20ToDemocs[erc20];
    }

    //* DEMOCRACY ADMIN FUNCTIONS */

    function dInit(address defaultErc20) only_editors() external returns (bytes32 democHash) {
        // generating the democHash in this way guarentees it'll be unique/hard-to-brute-force
        // (particularly because `this` and prevBlockHash are part of the hash)
        democHash = keccak256(abi.encodePacked(democList.length, blockhash(block.number-1), this, defaultErc20));
        democList.push(democHash);
        democs[democHash].erc20 = defaultErc20;
        // this should never trigger if we have a good security model - entropy for 13 bytes ~ 2^(8*13) ~ 10^31
        assert(democPrefixToHash[bytes13(democHash)] == bytes32(0));
        democPrefixToHash[bytes13(democHash)] = democHash;
        erc20ToDemocs[defaultErc20].push(democHash);
        emit NewDemoc(democHash);
    }

    function setDAdmin(bytes32 democHash, address newAdmin) only_editors() external {
        democs[democHash].admin = newAdmin;
        emit DemocAdminSet(democHash, newAdmin);
    }

    function setDErc20(bytes32 democHash, address newErc20) only_editors() external {
        democs[democHash].erc20 = newErc20;
        erc20ToDemocs[newErc20].push(democHash);
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
        return (democs[democHash].erc20, democs[democHash].admin, democs[democHash].allBallots.length);
    }

    function getDErc20(bytes32 democHash) external view returns (address) {
        return democs[democHash].erc20;
    }

    function getDAdmin(bytes32 democHash) external view returns (address) {
        return democs[democHash].admin;
    }

    function getDBallotsN(bytes32 democHash) external view returns (uint256) {
        return democs[democHash].allBallots.length;
    }

    function getDBallotID(bytes32 democHash, uint256 n) external view returns (uint ballotId) {
        return democs[democHash].allBallots[n];
    }

    function getDOfficialBallotsN(bytes32 democHash) external view returns (uint256) {
        return democs[democHash].officialBallots.length;
    }

    function getDOfficialBallotID(bytes32 democHash, uint256 officialN) external returns (uint256) {
        return democs[democHash].officialBallots[officialN];
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

    function _commitBallot(bytes32 democHash, uint ballotId, uint256 packed) internal {
        uint16 subBits;
        subBits = BPackedUtils.packedToSubmissionBits(packed);

        democs[democHash].allBallots.push(ballotId);

        if (BBLib.isOfficial(subBits)) {
            democs[democHash].officialBallots.push(ballotId);
        }

        emit NewBallot(democHash, democs[democHash].allBallots.length - 1);
    }

    function dAddBallot(bytes32 democHash, uint ballotId, uint256 packed) only_editors() external {
        _commitBallot(democHash, ballotId, packed);
    }
}


contract ixEvents {
    event PaymentMade(uint[2] valAndRemainder);
    event Emergency(bytes32 setWhat);
    event EmergencyDemocAdmin(bytes32 democHash, address newAdmin);
}


contract SVLightIndex is owned, upgradePtr, payoutAll, IxIface, ixBackendEvents, ixEvents {
    IxBackendIface public backend;
    IxPaymentsIface public payments;
    SVAdminPxFactory public adminPxFactory;
    SvEnsEverythingPx public ensPx;
    EnsOwnerProxy public ensOwnerPx;
    BBFarm bbfarm;

    uint256 constant _version = 2;

    //* MODIFIERS /

    modifier onlyDemocAdmin(bytes32 democHash) {
        require(msg.sender == backend.getDAdmin(democHash), "!democ-admin");
        _;
    }

    //* FUNCTIONS *//

    // constructor
    constructor( IxBackendIface _b
               , IxPaymentsIface _pay
               , SVAdminPxFactory _pxF
               , SvEnsEverythingPx _ensPx
               , EnsOwnerProxy _ensOwnerPx
               , BBFarm _bbfarm
               ) public {
        backend = _b;
        payments = _pay;
        adminPxFactory = _pxF;
        ensPx = _ensPx;
        ensOwnerPx = _ensOwnerPx;
        bbfarm = _bbfarm;
    }

    //* UPGRADE STUFF */

    function doUpgrade(address nextSC) only_owner() not_upgraded() external {
        doUpgradeInternal(nextSC);
        backend.upgradeMe(nextSC);
        payments.upgradeMe(nextSC);
        bbfarm.upgradeMe(nextSC);
        ensPx.upgradeMeAdmin(nextSC);
        ensOwnerPx.setAddr(nextSC);
        ensOwnerPx.upgradeMeAdmin(nextSC);
    }

    /* FOR EMERGENCIES */

    function emergencySetPaymentBackend(IxPaymentsIface newSC) only_owner() external {
        payments = newSC;
        emit Emergency(bytes32("payments"));
    }

    function emergencySetBackend(IxBackendIface newSC) only_owner() external {
        backend = newSC;
        emit Emergency(bytes32("backend"));
    }

    function emergencySetAdminPxFactory(address _pxF) only_owner() external {
        adminPxFactory = SVAdminPxFactory(_pxF);
        emit Emergency(bytes32("adminPxF"));
    }

    function emergencySetBBFarm(address _bbFarm) only_owner() external {
        bbfarm = BBFarm(_bbFarm);
        emit Emergency(bytes32("bbFarm"));
    }

    function emergencySetDAdmin(bytes32 democHash, address newAdmin) only_owner() external {
        backend.setDAdmin(democHash, newAdmin);
        emit EmergencyDemocAdmin(democHash, newAdmin);
    }

    //* GLOBAL INFO */

    function getVersion() external view returns (uint256) {
        return _version;
    }

    function getBBFarm() external view returns (address) {
        return bbfarm;
    }

    function getPayTo() external view returns (address) {
        return payments.getPayTo();
    }

    function getCommunityBallotCentsPrice() external view returns (uint) {
        return payments.getCommunityBallotCentsPrice();
    }

    function getCommunityBallotWeiPrice() external view returns (uint) {
        return payments.getCommunityBallotWeiPrice();
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

    // // we should probs just put this in a separate utils contract
    // function getDBallotsRange(bytes32 democHash, uint start, uint end) external view returns (uint256[] memory ballotIds) {
    //     assert(end >= start)
    //     for (uint i = start; i <= end; i++) {
    //         ballotIds = MemAppArr.appendUint256(ballotIds, backend.getDBallotID(i));
    //     }
    // }

    function getDBallotID(bytes32 democHash, uint256 n) external view returns (uint256) {
        return backend.getDBallotID(democHash, n);
    }

    function getDInfo(bytes32 democHash) external view returns (address erc20, address admin, uint256 _nBallots) {
        return backend.getDInfo(democHash);
    }

    function getDErc20(bytes32 democHash) external view returns (address erc20) {
        return backend.getDErc20(democHash);
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

    function _addBallot(bytes32 democHash, uint256 ballotId, uint256 packed) internal {
        // backend handles events
        backend.dAddBallot(democHash, ballotId, packed);
    }

    // manually add a ballot - only the owner can call this
    function dAddBallot(bytes32 democHash, uint ballotId, uint256 packed)
                      only_owner()
                      external {
        _addBallot(democHash, ballotId, packed);
    }

    function _deployBallotChecks(bytes32 democHash, uint64 endTime) internal view {
        // if the ballot is marked as official require the democracy is paid up to
        // some relative amount - exclude NFP accounts from this check
        uint secsLeft = payments.getSecondsRemaining(democHash);
        // must be positive due to ending in future check
        uint256 secsToEndTime = endTime - now;
        // require ballots end no more than twice the time left on the democracy
        require(secsLeft * 2 > secsToEndTime, "unpaid");
    }

    function _basicBallotLimitOperations(bytes32 democHash) internal {
        // if we're an official ballot and the democ is basic, ensure the democ
        // isn't over the ballots/mo limit
        if (payments.getPremiumStatus(democHash) == false) {
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
            uint earlyBallotTs = bbfarm.getCreationTs(earlyBallotId);

            // if the earlyBallot was created more than 30 days in the past we're okay
            if (earlyBallotTs < now - 30 days) {
                return;
            }

            // at this point it may be the case that we shouldn't allow the ballot
            // to be created. (It's an official ballot for a basic tier democracy
            // where the Nth most recent ballot was created within the last 30 days.)
            // We should now check for payment
            uint extraBallotFee = payments.getBasicExtraBallotFeeWei();
            require(msg.value >= extraBallotFee, "!extra-b-fee");

            // now that we know they've paid the fee, we should send Eth to `payTo`
            // and return the remainder.
            uint remainder = msg.value - extraBallotFee;
            doSafeSend(address(payments), extraBallotFee);
            doSafeSend(msg.sender, remainder);

            return;
        }
    }

    function dDeployBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, uint256 packed)
                          onlyDemocAdmin(democHash)
                          // todo: handling payments here
                          external payable
                          returns (uint ballotId) {

        // we need to end in the future
        uint64 endTime = BPackedUtils.packedToEndTime(packed);
        require(endTime > uint64(now), "b-end-time");

        uint16 submissionBits = BPackedUtils.packedToSubmissionBits(packed);
        require(BBLib.isTesting(submissionBits) == false, "b-testing");

        if (BBLib.isOfficial(submissionBits)) {
            _basicBallotLimitOperations(democHash);
            _deployBallotChecks(democHash, endTime);
        }

        ballotId = bbfarm.initBallot(
            specHash,
            packed,
            this,
            msg.sender,
            extraData);

        _addBallot(democHash, ballotId, packed);
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
    function b13ToBytes(bytes13 b13) pure internal returns(bytes) {
        bytes memory bs = new bytes(13);
        for (uint i = 0; i < 13; i++) {
            bs[i] = b13[i];
        }
        return bs;
    }
}
