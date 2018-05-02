pragma solidity ^0.4.23;


import { BallotBoxIface } from "./BallotBoxIface.sol";


interface IxIface {
    function getVersion() external view returns (uint256);

    function doUpgrade(address) external;
    function setPaymentBackend(IxPaymentsSettingsIface) external;
    function setBackend(IxBackendIface) external;

    function getPaymentEnabled() external view returns (bool);
    function getPayTo() external returns(address);
    function payForDemocracy(bytes32 democHash) external payable;
    function accountInGoodStanding(bytes32 democHash) external view returns (bool);

    function getCommunityBallotFee() external returns (uint);

    function dInit(string name) external payable returns (bytes32);
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
    function getDBallot(bytes32 democHash, uint n) external view returns (bytes32 specHash, bytes32 extraData, BallotBoxIface bb, uint64 startTime, uint64 endTime);
    function getDBallotBox(bytes32 democHash, uint id) external view returns (BallotBoxIface);
    function getDBallotAddr(bytes32 democHash, uint n) external view returns (address);

    event DemocAdded(bytes32 democHash, address admin);
}


interface IxPaymentsSettingsIface {
    function upgradeMe(address) external returns (bool);

    function payoutAll() external;

    function setPayTo(address) external;
    function getPayTo() external view returns (address);

    function setPaymentEnabled(bool) external;
    function getPaymentEnabled() external view returns (bool);

    function getCommunityBallotFee() external view returns (uint);
    function setCommunityBallotFee(uint) external;

    function setBasicPricePerSecond(uint amount) external;
    function getBasicPricePerSecond() external view returns(uint);
    function setPremiumMultiplier(uint8 amount) external;
    function getPremiumMultiplier() external view returns (uint8);
    function getPremiumPricePerSecond() external view returns (uint);

    function downgradeToBasic(bytes32 democHash) external;
    function upgradeToPremium(bytes32 democHash) external;

    function payForDemocracy(bytes32 democHash) external payable;
    function accountInGoodStanding(bytes32 democHash) external view returns (bool);

    function giveTimeToDemoc(bytes32 democHash, uint additionalSeconds, bytes32 ref) external;
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
