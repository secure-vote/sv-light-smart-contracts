pragma solidity ^0.4.23;


import { SVLightBallotBox } from "./SVLightBallotBox.sol";


interface IxIface {
    function deployBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, uint128 packedTimes, uint16 _submissionBits) external payable returns (uint);
    function payForDemocracy(bytes32 democHash) external payable;
    function getPayTo() external returns(address);
    function getCommunityBallotFee() external returns (uint);
    function accountInGoodStanding(bytes32 democHash) external constant returns (bool);
    function getBallotAddr(bytes32 democHash, uint n) external constant returns (address);
}


interface IxPaymentsSettingsIface {
    function upgradeMe(address) external returns (bool);

    function payoutAll() external;

    function setPayTo(address) external;
    function getPayTo() external constant returns (address);

    function setPaymentEnabled(bool) external;
    function getPaymentEnabled() external constant returns (bool);

    function getCommunityBallotFee() external constant returns (uint);
    function setCommunityBallotFee(uint) external;

    function setBasicPricePerSecond(uint amount) external;
    function getBasicPricePerSecond() external constant returns(uint);
    function setPremiumMultiplier(uint8 amount) external;
    function getPremiumMultiplier() external constant returns (uint8);
    function getPremiumPricePerSecond() external constant returns (uint);

    function downgradeToBasic(bytes32 democHash) external;
    function upgradeToPremium(bytes32 democHash) external;

    function payForDemocracy(bytes32 democHash) external payable;
    function accountInGoodStanding(bytes32 democHash) external constant returns (bool);

    function giveTimeToDemoc(bytes32 democHash, uint additionalSeconds, bytes32 ref) external;
}


interface IxBackendIface {
    function upgradeMe(address) external returns (bool);
    // function democs(bytes32 democHash) external returns (string, address);
    // function ballotList(uint globalBallotN) external returns (bytes32, uint);
    // function democPrefixToHash(bytes13) external returns (bytes32);
    // function democList(uint) external returns (bytes32);
    function nDemocs() external constant returns (uint);
    function nBallotsGlobal() external constant returns (uint);

    function initDemoc(string) external returns (bytes32);

    function addCategory(bytes32 democHash, bytes32 categoryName, bool hasParent, uint parent) external returns (uint);
    function deprecateCategory(bytes32 democHash, uint categoryId) external;
    function getDemocNCategories(bytes32 democHash) external constant returns (uint);
    function getDemocCategory(bytes32 democHash, uint categoryId) external constant returns (bool, bytes32, bool, uint);

    function getDAdmin(bytes32 democHash) external constant returns (address);
    function setDAdmin(bytes32 democHash, address newAdmin) external;

    function getDemocInfo(bytes32 democHash) external constant returns (string name, address admin, uint256 nBallots);
    function getDName(bytes32 democHash) external constant returns (string);
    function nBallots(bytes32 democHash) external constant returns (uint256);
    function getNthBallot(bytes32 democHash, uint n) external constant returns (bytes32 specHash, bytes32 extraData, SVLightBallotBox bb, uint64 startTime, uint64 endTime);
    function getBallotBox(bytes32 democHash, uint id) external constant returns (SVLightBallotBox);
    function addBallot(bytes32 democHash, bytes32 extraData, SVLightBallotBox bb) external returns (uint ballotId);
    function getBallotAddr(bytes32 democHash, uint n) external constant returns (address);

    function getDemocHash(bytes13 prefix) external constant returns (bytes32);
}
