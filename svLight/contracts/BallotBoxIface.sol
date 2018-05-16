pragma solidity ^0.4.24;


interface BallotBoxIface {
    function getVersion() external view returns (uint256);

    function getBallotSigned(uint256) external view returns (bytes32 ballotData, bytes32 sender, uint32 blockN);
    function getBallotEth(uint256) external view returns (bytes32 ballotData, address sender, uint32 blockN);
    function getPubkey(uint256) external view returns (bytes32);
    function getSignature(uint256) external view returns (bytes32[2]);

    function hasVotedEth(address) external view returns (bool);

    function isTesting() external view returns (bool);
    function isOfficial() external view returns (bool);
    function isBinding() external view returns (bool);

    function isDeprecated() external view returns (bool);

    function getEncSeckey() external view returns (bytes32);
    function getSpecHash() external view returns (bytes32);
    function getSubmissionBits() external view returns (uint16);
    function getStartTime() external view returns (uint64);
    function getEndTime() external view returns (uint64);
    function getCreationBlock() external view returns (uint64);

    function submitBallotNoPk(bytes32 ballot) external returns (uint id);
    function submitBallotWithPk(bytes32 ballot, bytes32 encPK) external returns (uint id);
    function submitBallotSignedNoEnc(bytes32 ballot, bytes32 ed25519PK, bytes32[2] signature) external returns (uint id);
    function submitBallotSignedWithEnc(bytes32 ballot, bytes32 curve25519PK, bytes32 ed25519PK, bytes32[2] signature) external returns (uint id);

    function setOwner(address) external;

    function getBallotsEthFrom(address voter) external view
        returns ( uint[] memory ids
                , bytes32[] memory ballots
                , uint32[] memory blockNs
                , bytes32[] memory pks
                , bytes32[2][] memory sigs
                , bool authenticated);
    function getBallotsSignedFrom(bytes32 voter) external view
        returns ( uint[] memory ids
                , bytes32[] memory ballots
                , uint32[] memory blockNs
                , bytes32[] memory pks
                , bytes32[2][] memory sigs
                , bool authenticated);
}
