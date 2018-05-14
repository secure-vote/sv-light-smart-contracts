pragma solidity ^0.4.23;


import { BallotBoxIface } from "./BallotBoxIface.sol";


interface IxIface {
    function getVersion() external view returns (uint256);

    function doUpgrade(address) external;
    function setPaymentBackend(IxPaymentsIface) external;
    function setBackend(IxBackendIface) external;

    function getPaymentEnabled() external view returns (bool);
    function getPayTo() external returns (address);
    function getCommunityBallotCentsPrice() external returns (uint);

    function getGDemocsN() external view returns (uint256);
    function getGDemoc(uint256 n) external view returns (bytes32);

    function dInit(string democName) external payable returns (bytes32);

    function payForDemocracy(bytes32 democHash) external payable;
    function accountInGoodStanding(bytes32 democHash) external view returns (bool);

    function setDAdmin(bytes32 democHash, address newAdmin) external;
    function dAddCategory(bytes32 democHash, bytes32 categoryName, bool hasParent, uint parent) external returns (uint);
    function dDeprecateCategory(bytes32 democHash, uint categoryId) external;

    function dDeployBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, uint256 packed) external payable returns (uint);
    // only ix owner - used for adding past ballots
    function dAddBallot(bytes32 democHash, bytes32 extraData, BallotBoxIface bb) external returns (uint);

    /* global democ getters */
    function getDCategoriesN(bytes32 democHash) external view returns (uint);
    function getDCategory(bytes32 democHash, uint categoryId) external view returns (bool deprecated, bytes32 name, bool hasParent, uint parent);
    function getDAdmin(bytes32 democHash) external view returns (address);
    function getDInfo(bytes32 democHash) external view returns (string name, address admin, uint256 nBallots);
    function getDName(bytes32 democHash) external view returns (string);
    function getDHash(bytes13 prefix) external view returns (bytes32);

    /* democ ballot getters */
    function getDBallotsN(bytes32 democHash) external view returns (uint256);
    function getDBallot(bytes32 democHash, uint256 n) external view returns (bytes32 specHash, bytes32 extraData, BallotBoxIface bb, uint64 startTime, uint64 endTime);
    function getDBallotBox(bytes32 democHash, uint id) external view returns (BallotBoxIface);
    function getDBallotAddr(bytes32 democHash, uint n) external view returns (address);
}


interface IxPaymentsIface {
    function upgradeMe(address) external returns (bool);

    function payoutAll() external;

    function setPayTo(address) external;
    function getPayTo() external view returns (address);

    function setPaymentEnabled(bool) external;
    function getPaymentEnabled() external view returns (bool);

    function getCommunityBallotCentsPrice() external view returns (uint);
    function setCommunityBallotCentsPrice(uint) external;

    function setBasicCentsPricePer30Days(uint amount) external;
    function getBasicCentsPricePer30Days() external view returns(uint);
    function setPremiumMultiplier(uint8 amount) external;
    function getPremiumMultiplier() external view returns (uint8);
    function getPremiumPricePer30Days() external view returns (uint);
    function setWeiPerCent(uint weiPerCent) external;
    function getWeiPerCent() external view returns (uint weiPerCent);
    function getUsdEthExchangeRate() external view returns (uint centsPerEth);

    function downgradeToBasic(bytes32 democHash) external;
    function upgradeToPremium(bytes32 democHash) external;

    function payForDemocracy(bytes32 democHash) external payable;
    function accountInGoodStanding(bytes32 democHash) external view returns (bool);

    function giveTimeToDemoc(bytes32 democHash, uint additionalSeconds, bytes32 ref) external;

    function getPaymentLogN() external view returns (uint);
    function getPaymentLog(uint n) external view returns (bool _external, bytes32 _democHash, uint _seconds, uint _ethValue);

    event PaymentEnabled(bool feeEnabled);
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

    function getGDemocsN() external view returns (uint);
    function getGDemoc(uint id) external view returns (bytes32);
    function getGBallotsN() external view returns (uint);
    function getGBallot(uint id) external view returns (bytes32 democHash, uint ballotId);

    function dInit(string) external returns (bytes32);
    function dAddBallot(bytes32 democHash, bytes32 extraData, BallotBoxIface bb) external returns (uint ballotId);
    function dAddCategory(bytes32 democHash, bytes32 categoryName, bool hasParent, uint parent) external returns (uint);
    function dDeprecateCategory(bytes32 democHash, uint categoryId) external;
    function setDAdmin(bytes32 democHash, address newAdmin) external;

    /* global democ getters */
    function getDCategoriesN(bytes32 democHash) external view returns (uint);
    function getDCategory(bytes32 democHash, uint categoryId) external view returns (bool deprecated, bytes32 name, bool hasParent, uint parent);
    function getDAdmin(bytes32 democHash) external view returns (address);
    function getDInfo(bytes32 democHash) external view returns (string name, address admin, uint256 nBallots);
    function getDName(bytes32 democHash) external view returns (string);

    /* democ ballot getters */
    function getDBallotsN(bytes32 democHash) external view returns (uint256);
    function getDBallot(bytes32 democHash, uint n) external view returns (bytes32 specHash, bytes32 extraData, BallotBoxIface bb, uint64 startTime, uint64 endTime);
    function getDBallotBox(bytes32 democHash, uint id) external view returns (BallotBoxIface);
    function getDBallotAddr(bytes32 democHash, uint n) external view returns (address);

    /* just for prefix stuff */
    function getDHash(bytes13 prefix) external view returns (bytes32);
}
