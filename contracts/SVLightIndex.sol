pragma solidity ^0.4.24;


//
// The Index by which democracies and ballots are tracked (and optionally deployed).
// Author: Max Kaye <max@secure.vote>
// License: MIT
// version: v1.2.0 [WIP]
//


import { SVLightAdminProxy } from "./SVLightAdminProxy.sol";
import { permissioned, hasAdmins, owned, upgradePtr, payoutAllC } from "./SVCommon.sol";
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


contract SVAdminPxFactory is payoutAllC {
    function spawn(bytes32 democHash, address initAdmin, address fwdTo) external returns (SVLightAdminProxy px) {
        px = new SVLightAdminProxy(democHash, initAdmin, fwdTo);
    }
}


contract ixBackendEvents {
    event NewBallot(bytes32 indexed democHash, uint ballotN);
    event NewDemoc(bytes32 democHash);
    event DemocAdminSet(bytes32 indexed democHash, address admin);
    event ManuallyAddedDemoc(bytes32 democHash, address erc20);
}


contract SVIndexBackend is IxBackendIface, permissioned, ixBackendEvents, payoutAllC {
    struct Democ {
        address erc20;
        address admin;
        uint256[] allBallots;
        uint256[] includedBasicBallots;  // the IDs of official ballots
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

    function _addDemoc(bytes32 democHash, address erc20) internal {
        democList.push(democHash);
        democs[democHash].erc20 = erc20;
        // this should never trigger if we have a good security model - entropy for 13 bytes ~ 2^(8*13) ~ 10^31
        assert(democPrefixToHash[bytes13(democHash)] == bytes32(0));
        democPrefixToHash[bytes13(democHash)] = democHash;
        erc20ToDemocs[erc20].push(democHash);
        emit NewDemoc(democHash);
    }

    function dInit(address defaultErc20) only_editors() external returns (bytes32 democHash) {
        // generating the democHash in this way guarentees it'll be unique/hard-to-brute-force
        // (particularly because prevBlockHash and now are part of the hash)
        democHash = keccak256(abi.encodePacked(democList.length, blockhash(block.number-1), defaultErc20, now));
        _addDemoc(democHash, defaultErc20);
    }

    function dAdd(bytes32 democHash, address erc20) only_owner() external {
        _addDemoc(democHash, erc20);
        emit ManuallyAddedDemoc(democHash, erc20);
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

    function getDCountedBasicBallotsN(bytes32 democHash) external view returns (uint256) {
        return democs[democHash].includedBasicBallots.length;
    }

    function getDCountedBasicBallotID(bytes32 democHash, uint256 n) external view returns (uint256) {
        return democs[democHash].includedBasicBallots[n];
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

    function _commitBallot(bytes32 democHash, uint ballotId, uint256 packed, bool recordTowardsBasicLimit) internal {
        uint16 subBits;
        subBits = BPackedUtils.packedToSubmissionBits(packed);

        democs[democHash].allBallots.push(ballotId);

        // do this for anything that doesn't qualify as a community ballot
        if (recordTowardsBasicLimit) {
            democs[democHash].includedBasicBallots.push(ballotId);
        }

        emit NewBallot(democHash, democs[democHash].allBallots.length - 1);
    }

    function dAddBallot(bytes32 democHash, uint ballotId, uint256 packed, bool recordTowardsBasicLimit) only_editors() external {
        _commitBallot(democHash, ballotId, packed, recordTowardsBasicLimit);
    }
}


contract ixEvents {
    event PaymentMade(uint[2] valAndRemainder);
    event Emergency(bytes32 setWhat);
    event EmergencyDemocAdmin(bytes32 democHash, address newAdmin);
    event EmergencyBBFarm(uint16 bbFarmId);
    event AddedBBFarm(uint16 bbFarmId);
}


contract SVLightIndex is owned, upgradePtr, payoutAllC, IxIface, ixBackendEvents, ixEvents {
    IxBackendIface public backend;
    IxPaymentsIface public payments;
    SVAdminPxFactory public adminPxFactory;
    SvEnsEverythingPx public ensPx;
    EnsOwnerProxy public ensOwnerPx;
    BBFarm[] bbFarms;
    // mapping from bbFarm namespace to bbFarmId
    mapping (uint32 => uint16) bbFarmIdLookup;
    // allows democ admins to store arbitrary data
    // this lets us (for example) set particular keys to signal cerain
    // things to client apps s.t. the admin can turn them on and off.
    // arbitraryData[democHash][key]
    mapping (bytes32 => mapping (uint256 => uint256)) arbitraryData;

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
               , BBFarm _bbFarm0
               ) public {
        backend = _b;
        payments = _pay;
        adminPxFactory = _pxF;
        ensPx = _ensPx;
        ensOwnerPx = _ensOwnerPx;
        _addBBFarm(0, _bbFarm0);
    }

    //* UPGRADE STUFF */

    function doUpgrade(address nextSC) only_owner() not_upgraded() external {
        doUpgradeInternal(nextSC);
        backend.upgradeMe(nextSC);
        payments.upgradeMe(nextSC);
        ensPx.upgradeMeAdmin(nextSC);
        ensOwnerPx.setAddr(nextSC);
        ensOwnerPx.upgradeMeAdmin(nextSC);

        for (uint i = 0; i < bbFarms.length; i++) {
            bbFarms[i].upgradeMe(nextSC);
        }
    }

    function _addBBFarm(uint32 bbNamespace, BBFarm _bbFarm) internal returns (uint16 bbFarmId) {
        bbFarmId = uint16(bbFarms.length);
        bbFarms.push(_bbFarm);
        bbFarmIdLookup[bbNamespace] = bbFarmId;
        emit AddedBBFarm(bbFarmId);
    }

    // adding a new BBFarm
    function addBBFarm(address bbFarm) only_owner() external returns (uint16 bbFarmId) {
        // what a nonsense line of code below. bah.
        BBFarm _bbFarm = BBFarm(bbFarm);
        uint32 bbNamespace = _bbFarm.getNamespace();
        require(bbNamespace > 0, 'bb-farm-namespace');
        // the only place where namespace -> 0 is for the init bbFarm, which we can never be atm
        require(bbFarmIdLookup[bbNamespace] == 0, 'bb-farm-exists');
        return _addBBFarm(bbNamespace, _bbFarm);
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

    function emergencySetBBFarm(uint16 bbFarmId, address _bbFarm) only_owner() external {
        bbFarms[bbFarmId] = BBFarm(_bbFarm);
        emit EmergencyBBFarm(bbFarmId);
    }

    function emergencySetDAdmin(bytes32 democHash, address newAdmin) only_owner() external {
        backend.setDAdmin(democHash, newAdmin);
        emit EmergencyDemocAdmin(democHash, newAdmin);
    }

    //* GLOBAL INFO */

    function getVersion() external view returns (uint256) {
        return _version;
    }

    function getBBFarm(uint16 i) external view returns (address) {
        return bbFarms[i];
    }

    function getBBFarmId(uint32 bbNamespace) external view returns (uint16) {
        return bbFarmIdLookup[bbNamespace];
    }

    function getBBFarmFromBallotID(uint256 ballotId) external view returns (address) {
        uint32 bbNamespace = uint32(ballotId >> 40);
        uint16 bbFarmId = bbFarmIdLookup[bbNamespace];
        return address(bbFarms[bbFarmId]);
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

    function dSetArbitraryData(bytes32 democHash, uint256 key, uint256 value) onlyDemocAdmin(democHash) external {
        arbitraryData[democHash][key] = value;
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

    function getDArbitraryData(bytes32 democHash, uint256 key) external view returns (uint256) {
        return arbitraryData[democHash][key];
    }

    //* ADD BALLOT TO RECORD */

    function _addBallot(bytes32 democHash, uint256 ballotId, uint256 packed, bool recordTowardsBasicLimit) internal {
        // backend handles events
        backend.dAddBallot(democHash, ballotId, packed, recordTowardsBasicLimit);
    }

    // manually add a ballot - only the owner can call this
    function dAddBallot(bytes32 democHash, uint ballotId, uint256 packed)
                      only_owner()
                      external {
        _addBallot(democHash, ballotId, packed, false);
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

    function _basicBallotLimitOperations(bytes32 democHash, BBFarm _bbFarm) internal returns (bool recordTowardsBasicLimit) {
        // if we're an official ballot and the democ is basic, ensure the democ
        // isn't over the ballots/mo limit
        if (payments.getPremiumStatus(democHash) == false) {
            uint nBallotsAllowed = payments.getBasicBallotsPer30Days();
            uint nBallotsBasicCounted = backend.getDCountedBasicBallotsN(democHash);

            // if the democ has less than nBallotsAllowed then it's guarenteed to be okay
            if (nBallotsAllowed > nBallotsBasicCounted) {
                // and we should count this ballot
                return true;
            }

            // we want to check the creation timestamp of the nth most recent ballot
            // where n is the # of ballots allowed per month. Note: there isn't an off
            // by 1 error here because if 1 ballots were allowed per month then we'd want
            // to look at the most recent ballot, so nBallotsBasicCounted-1 in this case.
            // similarly, if X ballots were allowed per month we want to look at
            // nBallotsBasicCounted-X. There would thus be (X-1) ballots that are _more_
            // recent than the one we're looking for.
            uint earlyBallotId = backend.getDCountedBasicBallotID(democHash, nBallotsBasicCounted - nBallotsAllowed);
            uint earlyBallotTs = _bbFarm.getCreationTs(earlyBallotId);

            // if the earlyBallot was created more than 30 days in the past we should
            // count the new ballot
            if (earlyBallotTs < now - 30 days) {
                return true;
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
            emit PaymentMade([extraBallotFee, remainder]);

            // only in this case do we want to return false - don't count towards the
            // limit because it's been paid for here.
            return false;
        } else {  // if we're premium we don't count ballots
            return false;
        }
    }

    function dDeployBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, uint256 packed)
                          onlyDemocAdmin(democHash)
                          // todo: handling payments here
                          external payable
                          returns (uint ballotId) {

        uint64 endTime = BPackedUtils.packedToEndTime(packed);
        uint16 submissionBits = BPackedUtils.packedToSubmissionBits(packed);
        require(BBLib.isTesting(submissionBits) == false, "b-testing");

        // the most significant 2 bytes of extraData signals the bbFarm to use.
        uint16 bbFarmId = uint16(uint256(extraData) >> 240);
        BBFarm _bbFarm = bbFarms[bbFarmId];

        // by default we don't record towards the basic limit
        bool recordTowardsBasicLimit = false;
        // anything that isn't a community ballot counts towards the basic limit.
        // we want to check in cases where the ballot doesn't qualify as a community
        // ballot OR
        //    the ballot qualifies as a community ballot
        //    AND the admins have _disabled_ community ballots.
        bool requiresCheck = BBLib.qualifiesAsCommunityBallot(submissionBits) == false || _checkEvenIfCommBallot(democHash);
        if (requiresCheck) {
            recordTowardsBasicLimit = _basicBallotLimitOperations(democHash, _bbFarm);
            _deployBallotChecks(democHash, endTime);
        }

        // note: bbFarms are allocated a 40bit namespace for ballot ids (~10^12)
        // this should be enough to avoid eventual collisions.
        ballotId = _bbFarm.initBallot(
            specHash,
            packed,
            this,
            msg.sender,
            extraData);

        _addBallot(democHash, ballotId, packed, recordTowardsBasicLimit);
    }

    // this is a separate function b/c putting this inline in `requiresCheck` definition
    // will load the storage before it "shortcuts" (though bool use),
    // so this way we only access storage if we _really_ need to.
    // --
    // The point of this function is to count and check ballots even if they qualify
    // as a community ballot, b/c if the admin has turned off community ballots they
    // must be counted.
    // Returns true if community ballots disabled and the account is in good standing.
    // Returns false if comm bs are enabled, or the account is not in good standing
    function _checkEvenIfCommBallot(bytes32 democHash) internal view returns (bool) {
        SVLightAdminProxy admin = SVLightAdminProxy(backend.getDAdmin(democHash));
        return payments.accountInGoodStanding(democHash) && admin.getCommunityBallotsEnabled() == false;
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
