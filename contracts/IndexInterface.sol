pragma solidity ^0.4.24;


import { BBFarmIface } from "./BBFarmIface.sol";


interface IxIface {
    function doUpgrade(address) external;

    function addBBFarm(BBFarmIface bbFarm) external returns (uint8 bbFarmId);
    function emergencySetABackend(bytes32 toSet, address newSC) external;
    function emergencySetBBFarm(uint8 bbFarmId, address _bbFarm) external;
    function emergencySetDAdmin(bytes32 democHash, address newAdmin) external;

    function getPayments() external view returns (IxPaymentsIface);
    function getBackend() external view returns (IxBackendIface);
    function getBBFarm(uint8 bbFarmId) external view returns (BBFarmIface);
    function getBBFarmID(bytes4 bbNamespace) external view returns (uint8 bbFarmId);

    function getVersion() external view returns (uint256);

    function dInit(address defualtErc20) external payable returns (bytes32);

    function setDErc20(bytes32 democHash, address newErc20) external;
    function dAddCategory(bytes32 democHash, bytes32 categoryName, bool hasParent, uint parent) external returns (uint);
    function dDeprecateCategory(bytes32 democHash, uint categoryId) external;
    function dUpgradeToPremium(bytes32 democHash) external;
    function dDowngradeToBasic(bytes32 democHash) external;
    function dSetArbitraryData(bytes32 democHash, bytes key, bytes value) external;

    /* democ getters (that used to be here) should be called on either backend or payments directly */
    /* use IxLib for convenience functions from other SCs */

    /* ballot deployment */
    // only ix owner - used for adding past or special ballots
    function dAddBallot(bytes32 democHash, uint ballotId, uint256 packed) external;
    function dDeployBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, uint256 packed) external payable returns (uint);


    /* events */
    event PaymentMade(uint[2] valAndRemainder);
    event Emergency(bytes32 setWhat);
    event EmergencyDemocAdmin(bytes32 democHash, address newAdmin);
    event EmergencyBBFarm(uint16 bbFarmId);
    event AddedBBFarm(uint16 bbFarmId);
    event ManuallyAddedBallot(bytes32 democHash, uint256 ballotId, uint256 packed);
    // from backend
    event NewBallot(bytes32 indexed democHash, uint ballotN);
    event NewDemoc(bytes32 democHash);
    event DemocAdminSet(bytes32 indexed democHash, address admin);
    // from BBFarm
    event BallotCreatedWithID(uint ballotId);
}


interface IxPaymentsIface {
    function upgradeMe(address) external;

    function payoutAll() external;

    function setPayTo(address) external;
    function getPayTo() external view returns (address);
    function setMinorEditsAddr(address) external;

    function getCommunityBallotCentsPrice() external view returns (uint);
    function setCommunityBallotCentsPrice(uint) external;
    function getCommunityBallotWeiPrice() external view returns (uint);

    function setBasicCentsPricePer30Days(uint amount) external;
    function getBasicCentsPricePer30Days() external view returns(uint);
    function getBasicExtraBallotFeeWei() external view returns (uint);
    function getBasicBallotsPer30Days() external view returns (uint);
    function setBasicBallotsPer30Days(uint amount) external;
    function setPremiumMultiplier(uint8 amount) external;
    function getPremiumMultiplier() external view returns (uint8);
    function getPremiumCentsPricePer30Days() external view returns (uint);
    function setWeiPerCent(uint) external;
    function setFreeExtension(bytes32 democHash, bool hasFreeExt) external;
    function getWeiPerCent() external view returns (uint weiPerCent);
    function getUsdEthExchangeRate() external view returns (uint centsPerEth);

    function weiBuysHowManySeconds(uint amount) external view returns (uint secs);

    function downgradeToBasic(bytes32 democHash) external;
    function upgradeToPremium(bytes32 democHash) external;
    function doFreeExtension(bytes32 democHash) external;

    function payForDemocracy(bytes32 democHash) external payable;
    function accountInGoodStanding(bytes32 democHash) external view returns (bool);
    function getSecondsRemaining(bytes32 democHash) external view returns (uint);
    function getPremiumStatus(bytes32 democHash) external view returns (bool);
    function getAccount(bytes32 democHash) external view returns (bool isPremium, uint lastPaymentTs, uint paidUpTill, bool hasFreeExtension);
    function getFreeExtension(bytes32 democHash) external view returns (bool);

    function giveTimeToDemoc(bytes32 democHash, uint additionalSeconds, bytes32 ref) external;

    function setDenyPremium(bytes32 democHash, bool isPremiumDenied) external;
    function getDenyPremium(bytes32 democHash) external view returns (bool);

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
}


interface IxBackendIface {
    function upgradeMe(address) external;

    /* global getters */
    function getGDemocsN() external view returns (uint);
    function getGDemoc(uint id) external view returns (bytes32);
    function getGErc20ToDemocs(address erc20) external view returns (bytes32[] democHashes);

    /* democ admin */
    function dInit(address defaultErc20) external returns (bytes32);
    function dAddBallot(bytes32 democHash, uint ballotId, uint256 packed, bool recordTowardsBasicLimit) external;
    function dAddCategory(bytes32 democHash, bytes32 categoryName, bool hasParent, uint parent) external returns (uint);
    function dDeprecateCategory(bytes32 democHash, uint categoryId) external;
    function setDAdmin(bytes32 democHash, address newAdmin) external;
    function setDErc20(bytes32 democHash, address newErc20) external;
    function dSetArbitraryData(bytes32 democHash, bytes key, bytes value) external;

    /* global democ getters */
    function getDInfo(bytes32 democHash) external view returns (address erc20, address admin, uint256 nBallots);
    function getDErc20(bytes32 democHash) external view returns (address);
    function getDAdmin(bytes32 democHash) external view returns (address);
    function getDArbitraryData(bytes32 democHash, bytes key) external view returns (bytes value);

    function getDBallotsN(bytes32 democHash) external view returns (uint256);
    function getDBallotID(bytes32 democHash, uint n) external view returns (uint ballotId);
    function getDCountedBasicBallotsN(bytes32 democHash) external view returns (uint256);
    function getDCountedBasicBallotID(bytes32 democHash, uint256 n) external view returns (uint256);

    function getDCategoriesN(bytes32 democHash) external view returns (uint);
    function getDCategory(bytes32 democHash, uint categoryId) external view returns (bool deprecated, bytes32 name, bool hasParent, uint parent);

    /* just for prefix stuff */
    function getDHash(bytes13 prefix) external view returns (bytes32);

    /* events */
    event NewBallot(bytes32 indexed democHash, uint ballotN);
    event NewDemoc(bytes32 democHash);
    event DemocAdminSet(bytes32 indexed democHash, address admin);
}
