pragma solidity 0.4.24;



import "./IndexInterface.sol";
import "./SVCommon.sol";
import "./BPackedUtils.sol";



contract ixBackendEvents {
    event NewDemoc(bytes32 democHash);
    event ManuallyAddedDemoc(bytes32 democHash, address erc20);
    event NewBallot(bytes32 indexed democHash, uint ballotN);
    event DemocOwnerSet(bytes32 indexed democHash, address owner);
    event DemocEditorSet(bytes32 indexed democHash, address editor, bool canEdit);
    event DemocEditorsWiped(bytes32 indexed democHash);
    event DemocErc20Set(bytes32 indexed democHash, address erc20);
    event DemocDataSet(bytes32 indexed democHash, bytes32 keyHash);
    event DemocCatAdded(bytes32 indexed democHash, uint catId);
    event DemocCatDeprecated(bytes32 indexed democHash, uint catId);
    event DemocCommunityBallotsEnabled(bytes32 indexed democHash, bool enabled);
}


contract SVIndexBackend is IxBackendIface, permissioned, ixBackendEvents, payoutAllC {
    struct Democ {
        address erc20;
        address owner;
        bool communityBallotsDisabled;
        uint editorEpoch;
        mapping (uint => mapping (address => bool)) editors;
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

    // allows democ admins to store arbitrary data
    // this lets us (for example) set particular keys to signal cerain
    // things to client apps s.t. the admin can turn them on and off.
    // arbitraryData[democHash][key]
    mapping (bytes32 => mapping (bytes32 => bytes)) arbitraryData;

    /* GLOBAL INFO */

    function getGDemocsN() external view returns (uint) {
        return democList.length;
    }

    function getGDemoc(uint id) external view returns (bytes32) {
        return democList[id];
    }

    function getGErc20ToDemocs(address erc20) external view returns (bytes32[] democHashes) {
        return erc20ToDemocs[erc20];
    }

    /* Owner functions */

    function dAdd(bytes32 democHash, address erc20) only_owner() external {
        _addDemoc(democHash, erc20);
        emit ManuallyAddedDemoc(democHash, erc20);
    }

    /* DEMOCRACY ADMIN FUNCTIONS */

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

    function setDOwner(bytes32 democHash, address newOwner) only_editors() external {
        democs[democHash].owner = newOwner;
        emit DemocOwnerSet(democHash, newOwner);
    }

    function setDEditor(bytes32 democHash, address editor, bool canEdit) only_editors() external {
        Democ storage d = democs[democHash];
        d.editors[d.editorEpoch][editor] = canEdit;
        emit DemocEditorSet(democHash, editor, canEdit);
    }

    function setDNoEditors(bytes32 democHash) only_editors() external {
        democs[democHash].editorEpoch += 1;
        emit DemocEditorsWiped(democHash);
    }

    function setDErc20(bytes32 democHash, address newErc20) only_editors() external {
        democs[democHash].erc20 = newErc20;
        erc20ToDemocs[newErc20].push(democHash);
        emit DemocErc20Set(democHash, newErc20);
    }

    function dSetArbitraryData(bytes32 democHash, bytes key, bytes value) only_editors() external {
        bytes32 k = keccak256(key);
        arbitraryData[democHash][k] = value;
        emit DemocDataSet(democHash, k);
    }

    function dAddCategory(bytes32 democHash, bytes32 name, bool hasParent, uint parent) only_editors() external {
        uint catId = democCategories[democHash].nCategories;
        democCategories[democHash].categories[catId].name = name;
        if (hasParent) {
            democCategories[democHash].categories[catId].hasParent = true;
            democCategories[democHash].categories[catId].parent = parent;
        }
        democCategories[democHash].nCategories += 1;
        emit DemocCatAdded(democHash, catId);
    }

    function dDeprecateCategory(bytes32 democHash, uint catId) only_editors() external {
        democCategories[democHash].categories[catId].deprecated = true;
        emit DemocCatDeprecated(democHash, catId);
    }

    function dSetCommunityBallotsEnabled(bytes32 democHash, bool enabled) only_editors() external {
        democs[democHash].communityBallotsDisabled = !enabled;
        emit DemocCommunityBallotsEnabled(democHash, enabled);
    }

    //* ADD BALLOT TO RECORD */

    function _commitBallot(bytes32 democHash, uint ballotId, uint256 packed, bool recordTowardsBasicLimit) internal {
        uint16 subBits;
        subBits = BPackedUtils.packedToSubmissionBits(packed);

        uint localBallotId = democs[democHash].allBallots.length;
        democs[democHash].allBallots.push(ballotId);

        // do this for anything that doesn't qualify as a community ballot
        if (recordTowardsBasicLimit) {
            democs[democHash].includedBasicBallots.push(ballotId);
        }

        emit NewBallot(democHash, localBallotId);
    }

    function dAddBallot(bytes32 democHash, uint ballotId, uint256 packed, bool countTowardsLimit) only_editors() external {
        _commitBallot(democHash, ballotId, packed, countTowardsLimit);
    }

    /* democ getters */

    function getDOwner(bytes32 democHash) external view returns (address) {
        return democs[democHash].owner;
    }

    function isDEditor(bytes32 democHash, address editor) external view returns (bool) {
        Democ storage d = democs[democHash];
        // allow either an editor or always the owner
        return d.editors[d.editorEpoch][editor] || editor == d.owner;
    }

    function getDHash(bytes13 prefix) external view returns (bytes32) {
        return democPrefixToHash[prefix];
    }

    function getDInfo(bytes32 democHash) external view returns (address erc20, address owner, uint256 nBallots) {
        return (democs[democHash].erc20, democs[democHash].owner, democs[democHash].allBallots.length);
    }

    function getDErc20(bytes32 democHash) external view returns (address) {
        return democs[democHash].erc20;
    }

    function getDArbitraryData(bytes32 democHash, bytes key) external view returns (bytes) {
        return arbitraryData[democHash][keccak256(key)];
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

    function getDCategory(bytes32 democHash, uint catId) external view returns (bool deprecated, bytes32 name, bool hasParent, uint256 parent) {
        deprecated = democCategories[democHash].categories[catId].deprecated;
        name = democCategories[democHash].categories[catId].name;
        hasParent = democCategories[democHash].categories[catId].hasParent;
        parent = democCategories[democHash].categories[catId].parent;
    }

    function getDCommBallotsEnabled(bytes32 democHash) external view returns (bool) {
        return !democs[democHash].communityBallotsDisabled;
    }
}
