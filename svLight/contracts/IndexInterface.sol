pragma solidity ^0.4.23;


import { SVLightBallotBox } from "./SVLightBallotBox.sol";


interface IxIface {
    function deployBallot(bytes32 democHash, bytes32 specHash, bytes32 extraData, uint128 packedTimes, uint16 _submissionBits) external payable returns (uint);
    function communityEnabled(bytes32 democHash) external returns (bool);
    function payForDemocracy(bytes32 democHash) external payable;
}


interface IxPaymentsSettingsIface {
    function democWhitelist(address) external returns (bool);
    function ballotWhitelist(address) external returns (bool);
    function payTo() external returns (address);
    function democFee() external returns (uint);
    function democFeeFor(address) external returns (uint);
    function ballotFee() external returns (uint);
    function ballotFeeFor(address) external returns (uint);
    function paymentEnabled() external returns (bool);
    function payoutAll() external;
    function setPayTo(address) external;
    function setEth(uint128[2]) external;
    function setPaymentEnabled(bool) external;
    function setWhitelistDemoc(address, bool) external;
    function setWhitelistBallot(address, bool) external;
    function setFeeFor(address, uint128[2]) external;
}


interface IxBackendIface {
    function democs(bytes32 democHash) external returns (string, address);
    function ballotList(uint globalBallotN) external returns (bytes32, uint);
    function democPrefixToHash(bytes13) external returns (bytes32);
    function democList(uint) external returns (bytes32);
    function nDemocs() external constant returns (uint);
    function nBallotsGlobal() external constant returns (uint);
    function initDemoc(string) external returns (bytes32);
    function getDemocInfo(bytes32 democHash) external constant returns (string name, address admin, uint256 nBallots);
    function getDName(bytes32 democHash) external constant returns (string);
    function getDAdmin(bytes32 democHash) external constant returns (address);
    function setAdmin(bytes32 democHash, address newAdmin) external;
    function nBallots(bytes32 democHash) external constant returns (uint256);
    function getNthBallot(bytes32 democHash, uint n) external constant returns (bytes32 specHash, bytes32 extraData, SVLightBallotBox bb, uint64 startTime, uint64 endTime);
    function getBallotBox(bytes32 democHash, uint id) external constant returns (SVLightBallotBox);
    function addBallot(bytes32 democHash, bytes32 extraData, SVLightBallotBox bb) external returns (uint ballotId);
}
