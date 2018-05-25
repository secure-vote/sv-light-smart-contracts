pragma solidity ^0.4.24;


import { BallotBoxIface } from "./BallotBoxIface.sol";


interface IxIface {
    function getVersion() external view returns (uint256);

    function doUpgrade(address) external;
    function emergencySetPaymentBackend(IxPaymentsIface) external;
    function emergencySetBackend(IxBackendIface) external;
    function emergencySetAdmin(bytes32 democHash, address newAdmin) external;
    function emergencySetAdminPxFactory(address _pxF) external;
    function emergencySetBBFactory(address _bbF) external;

    function getPayTo() external view returns (address);
    function getCommunityBallotCentsPrice() external view returns (uint);
    function getCommunityBallotWeiPrice() external view returns (uint);

    function getGDemocsN() external view returns (uint256);
    function getGDemoc(uint256 n) external view returns (bytes32);
    function getGErc20ToDemocs(address erc20) external view returns (bytes32[] democHashes);

    function dInit(address defualtErc20) external payable returns (bytes32);

    function payForDemocracy(bytes32 democHash) external payable;
    function accountInGoodStanding(bytes32 democHash) external view returns (bool);
    function accountPremiumAndInGoodStanding(bytes32 democHash) external view returns (bool);

    // disable this method bc we don't want admins to move away from our admin SC
    // function setDAdmin(bytes32 democHash, address newAdmin) external;
    function setDErc20(bytes32 democHash, address newErc20) external;
    function dAddCategory(bytes32 democHash, bytes32 categoryName, bool hasParent, uint parent) external returns (uint);
    function dDeprecateCategory(bytes32 democHash, uint categoryId) external;
    function dUpgradeToPremium(bytes32 democHash) external;
    function dDowngradeToBasic(bytes32 democHash) external;

    function dDeployBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, uint256 packed) external payable returns (uint);
    // only ix owner - used for adding past ballots
    function dAddBallot(bytes32 democHash, bytes32 extraData, BallotBoxIface bb, bytes32 specHash, uint256 packed) external returns (uint);

    /* global democ getters */
    function getDCategoriesN(bytes32 democHash) external view returns (uint);
    function getDCategory(bytes32 democHash, uint categoryId) external view returns (bool deprecated, bytes32 name, bool hasParent, uint parent);
    function getDAdmin(bytes32 democHash) external view returns (address);
    function getDInfo(bytes32 democHash) external view returns (address erc20, address admin, uint256 nBallots);
    function getDErc20(bytes32 democHash) external view returns (address);
    function getDHash(bytes13 prefix) external view returns (bytes32);

    /* democ ballot getters */
    function getDBallotsN(bytes32 democHash) external view returns (uint256);
    function getDBallot(bytes32 democHash, uint256 n) external view returns (bytes32 extraData, BallotBoxIface bb);
    function getDBallotBox(bytes32 democHash, uint id) external view returns (BallotBoxIface);
}


interface IxPaymentsIface {
    function upgradeMe(address) external returns (bool);

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
    function getPremiumPricePer30Days() external view returns (uint);
    function setWeiPerCent(uint) external;
    function getWeiPerCent() external view returns (uint weiPerCent);
    function getUsdEthExchangeRate() external view returns (uint centsPerEth);

    function weiBuysHowManySeconds(uint amount) external view returns (uint secs);

    function downgradeToBasic(bytes32 democHash) external;
    function upgradeToPremium(bytes32 democHash) external;

    function payForDemocracy(bytes32 democHash) external payable;
    function accountInGoodStanding(bytes32 democHash) external view returns (bool);
    function getSecondsRemaining(bytes32 democHash) external view returns (uint);
    function getPremiumStatus(bytes32 democHash) external view returns (bool);
    function getAccount(bytes32 democHash) external view returns (bool isPremium, uint lastPaymentTs, uint paidUpTill);

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
}


interface IxBackendIface {
    function upgradeMe(address) external returns (bool);

    /* global getters */
    function getGDemocsN() external view returns (uint);
    function getGDemoc(uint id) external view returns (bytes32);
    function getGBallotsN() external view returns (uint);
    function getGBallot(uint id) external view returns (bytes32 democHash, uint ballotId);
    function getGErc20ToDemocs(address erc20) external view returns (bytes32[] democHashes);

    /* democ admin */
    function dInit(address defaultErc20) external returns (bytes32);
    function dAddBallot(bytes32 democHash, bytes32 extraData, BallotBoxIface bb, bytes32 specHash, uint256 packed) external returns (uint ballotId);
    function dAddCategory(bytes32 democHash, bytes32 categoryName, bool hasParent, uint parent) external returns (uint);
    function dDeprecateCategory(bytes32 democHash, uint categoryId) external;
    function setDAdmin(bytes32 democHash, address newAdmin) external;
    function setDErc20(bytes32 democHash, address newErc20) external;

    /* global democ getters */
    function getDCategoriesN(bytes32 democHash) external view returns (uint);
    function getDCategory(bytes32 democHash, uint categoryId) external view returns (bool deprecated, bytes32 name, bool hasParent, uint parent);
    function getDAdmin(bytes32 democHash) external view returns (address);
    function getDInfo(bytes32 democHash) external view returns (address erc20, address admin, uint256 nBallots);
    function getDErc20(bytes32 democHash) external view returns (address);

    /* democ ballot getters */
    function getDBallotsN(bytes32 democHash) external view returns (uint256);
    function getDBallot(bytes32 democHash, uint n) external view returns (bytes32 extraData, BallotBoxIface bb);
    function getDBallotCreationTs(bytes32 democHash, uint n) external view returns (uint);
    function getDOfficialBallotsN(bytes32 democHash) external view returns (uint256);
    function getDOfficialBallotID(bytes32 democHash, uint256 officialN) external returns (uint256);
    function getDBallotBox(bytes32 democHash, uint id) external view returns (BallotBoxIface);

    /* just for prefix stuff */
    function getDHash(bytes13 prefix) external view returns (bytes32);

    /* events */
    event LowLevelNewBallot(bytes32 democHash, uint id);
    event LowLevelNewDemoc(bytes32 democHash);
}
