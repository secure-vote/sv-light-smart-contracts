pragma solidity ^0.4.24;


import "./BBFarmIface.sol";
import "./CommunityAuction.sol";


interface IxIface {
    function doUpgrade(address) external;

    function addBBFarm(BBFarmIface bbFarm) external returns (uint8 bbFarmId);
    function emergencySetABackend(bytes32 toSet, address newSC) external;
    function emergencySetBBFarm(uint8 bbFarmId, address _bbFarm) external;
    function emergencySetDOwner(bytes32 democHash, address newOwner) external;

    function getPayments() external view returns (IxPaymentsIface);
    function getBackend() external view returns (IxBackendIface);
    function getBBFarm(uint8 bbFarmId) external view returns (BBFarmIface);
    function getBBFarmID(bytes4 bbNamespace) external view returns (uint8 bbFarmId);
    function getCommAuction() external view returns (CommAuctionIface);

    function getVersion() external pure returns (uint256);

    function dInit(address defualtErc20) external payable returns (bytes32);

    function setDEditor(bytes32 democHash, address editor, bool canEdit) external;
    function setDOwner(bytes32 democHash, address owner) external;
    function setDErc20(bytes32 democHash, address newErc20) external;
    function dAddCategory(bytes32 democHash, bytes32 categoryName, bool hasParent, uint parent) external;
    function dDeprecateCategory(bytes32 democHash, uint categoryId) external;
    function dUpgradeToPremium(bytes32 democHash) external;
    function dDowngradeToBasic(bytes32 democHash) external;
    function dSetArbitraryData(bytes32 democHash, bytes key, bytes value) external;
    function dSetCommunityBallotsEnabled(bytes32 democHash, bool enabled) external;

    /* democ getters (that used to be here) should be called on either backend or payments directly */
    /* use IxLib for convenience functions from other SCs */

    /* ballot deployment */
    // only ix owner - used for adding past or special ballots
    function dAddBallot(bytes32 democHash, uint ballotId, uint256 packed) external;
    function dDeployCommunityBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, uint128 packedTimes) external payable;
    function dDeployBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, uint256 packed) external payable;


    /* events */
    event PaymentMade(uint[2] valAndRemainder);
    event AddedBBFarm(uint8 bbFarmId);
    event Emergency(bytes32 setWhat, address newSC);
    event EmergencyBBFarm(uint8 bbFarmId, address bbFarm);
    event EmergencyDemocOwner(bytes32 democHash, address newOwner);
    event CommunityBallot(bytes32 democHash, uint256 ballotId);
    event ManuallyAddedBallot(bytes32 democHash, uint256 ballotId, uint256 packed);
    // from backend
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
    // from BBFarm
    event BallotCreatedWithID(uint ballotId);
}


interface IxPaymentsIface {
    function upgradeMe(address) external;
    function payoutAll() external;

    /* in emergency break glass */
    function emergencySetOwner(address newOwner) external;

    /* financial calcluations */
    function weiBuysHowManySeconds(uint amount) external view returns (uint secs);
    function weiToCents(uint w) external view returns (uint);
    function centsToWei(uint c) external view returns (uint);

    /* account management */
    function payForDemocracy(bytes32 democHash) external payable;
    function doFreeExtension(bytes32 democHash) external;
    function downgradeToBasic(bytes32 democHash) external;
    function upgradeToPremium(bytes32 democHash) external;

    /* account status - getters */
    function accountInGoodStanding(bytes32 democHash) external view returns (bool);
    function getSecondsRemaining(bytes32 democHash) external view returns (uint);
    function getPremiumStatus(bytes32 democHash) external view returns (bool);
    function getFreeExtension(bytes32 democHash) external view returns (bool);
    function getAccount(bytes32 democHash) external view returns (bool isPremium, uint lastPaymentTs, uint paidUpTill, bool hasFreeExtension);
    function getDenyPremium(bytes32 democHash) external view returns (bool);

    /* admin utils for accounts */
    function giveTimeToDemoc(bytes32 democHash, uint additionalSeconds, bytes32 ref) external;

    /* admin setters global */
    function setPayTo(address) external;
    function setMinorEditsAddr(address) external;
    function setBasicCentsPricePer30Days(uint amount) external;
    function setBasicBallotsPer30Days(uint amount) external;
    function setPremiumMultiplier(uint8 amount) external;
    function setWeiPerCent(uint) external;
    function setFreeExtension(bytes32 democHash, bool hasFreeExt) external;
    function setDenyPremium(bytes32 democHash, bool isPremiumDenied) external;

    /* global getters */
    function getPayTo() external view returns (address);
    function getBasicCentsPricePer30Days() external view returns(uint);
    function getBasicExtraBallotFeeWei() external view returns (uint);
    function getBasicBallotsPer30Days() external view returns (uint);
    function getPremiumMultiplier() external view returns (uint8);
    function getPremiumCentsPricePer30Days() external view returns (uint);
    function getWeiPerCent() external view returns (uint weiPerCent);
    function getUsdEthExchangeRate() external view returns (uint centsPerEth);

    /* payments stuff */
    function getPaymentLogN() external view returns (uint);
    function getPaymentLog(uint n) external view returns (bool _external, bytes32 _democHash, uint _seconds, uint _ethValue);

    event UpgradedToPremium(bytes32 indexed democHash);
    event GrantedAccountTime(bytes32 indexed democHash, uint additionalSeconds, bytes32 ref);
    event AccountPayment(bytes32 indexed democHash, uint additionalSeconds);
    event SetCommunityBallotFee(uint amount);
    event SetBasicCentsPricePer30Days(uint amount);
    event SetPremiumMultiplier(uint8 multiplier);
    event DowngradeToBasic(bytes32 indexed democHash);
    event UpgradeToPremium(bytes32 indexed democHash);
    event SetExchangeRate(uint weiPerCent);
    event FreeExtension(bytes32 democHash);
    event SetBallotsPer30Days(uint amount);
    event SetFreeExtension(bytes32 democHash, bool hasFreeExt);
    event SetDenyPremium(bytes32 democHash, bool isPremiumDenied);
}


interface IxBackendIface {
    function upgradeMe(address) external;

    /* global getters */
    function getGDemocsN() external view returns (uint);
    function getGDemoc(uint id) external view returns (bytes32);
    function getGErc20ToDemocs(address erc20) external view returns (bytes32[] democHashes);

    /* owner functions */
    function dAdd(bytes32 democHash, address erc20) external;

    /* democ admin */
    function dInit(address defaultErc20) external returns (bytes32 democHash);
    function setDOwner(bytes32 democHash, address newOwner) external;
    function setDEditor(bytes32 democHash, address editor, bool canEdit) external;
    function setDNoEditors(bytes32 democHash) external;
    function setDErc20(bytes32 democHash, address newErc20) external;
    function dSetArbitraryData(bytes32 democHash, bytes key, bytes value) external;
    function dAddCategory(bytes32 democHash, bytes32 categoryName, bool hasParent, uint parent) external;
    function dDeprecateCategory(bytes32 democHash, uint catId) external;
    function dSetCommunityBallotsEnabled(bytes32 democHash, bool enabled) external;
    function dAddBallot(bytes32 democHash, uint ballotId, uint256 packed, bool countTowardsLimit) external;

    /* global democ getters */
    function getDOwner(bytes32 democHash) external view returns (address);
    function isDEditor(bytes32 democHash, address editor) external view returns (bool);
    function getDHash(bytes13 prefix) external view returns (bytes32);
    function getDInfo(bytes32 democHash) external view returns (address erc20, address owner, uint256 nBallots);
    function getDErc20(bytes32 democHash) external view returns (address);
    function getDArbitraryData(bytes32 democHash, bytes key) external view returns (bytes value);
    function getDBallotsN(bytes32 democHash) external view returns (uint256);
    function getDBallotID(bytes32 democHash, uint n) external view returns (uint ballotId);
    function getDCountedBasicBallotsN(bytes32 democHash) external view returns (uint256);
    function getDCountedBasicBallotID(bytes32 democHash, uint256 n) external view returns (uint256);
    function getDCategoriesN(bytes32 democHash) external view returns (uint);
    function getDCategory(bytes32 democHash, uint catId) external view returns (bool deprecated, bytes32 name, bool hasParent, uint parent);
    function getDCommBallotsEnabled(bytes32 democHash) external view returns (bool);


    /* events */
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
