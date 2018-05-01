pragma solidity ^0.4.23;


interface BallotBoxIface {
    function getVersion() external constant returns (uint256);

    function getBallotSigned(uint256) external constant returns (bytes32 ballotData, bytes32 sender, uint32 blockN);
    function getBallotEth(uint256) external constant returns (bytes32 ballotData, address sender, uint32 blockN);

    function hasVotedEth(address) external constant returns (bool);
}
