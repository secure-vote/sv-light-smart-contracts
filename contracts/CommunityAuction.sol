pragma solidity 0.4.24;

/**
    Manage community ballot prices.
 */

interface CommAuctionIface {
    function getNextPrice(bytes32 democHash) external view returns (uint);
    function noteBallotDeployed(bytes32 democHash) external;

    function upgradeMe(address newSC) external;
}
