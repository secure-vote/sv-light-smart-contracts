pragma solidity ^0.4.23;


interface BallotBoxIface {
    function getVersion() external constant returns (uint256);

    function getBallotSigned(uint256) external constant returns (bytes32 ballotData, bytes32 sender, uint32 blockN);
    function getBallotEth(uint256) external constant returns (bytes32 ballotData, address sender, uint32 blockN);
    function getPubkey(uint256) external constant returns (bytes32);
    function getSignature(uint256) external constant returns (bytes32[2]);

    function hasVotedEth(address) external constant returns (bool);

    function isTesting() external constant returns (bool);
    function isOfficial() external constant returns (bool);

    function isDeprecated() external constant returns (bool);

    function getEncSeckey() external constant returns (bytes32);

    function submitBallotNoPk(bytes32 ballot) external returns (uint id);
    function submitBallotWithPk(bytes32 ballot, bytes32 encPK) external returns (uint id);
    function submitBallotSignedNoEnc(bytes32 ballot, bytes32 ed25519PK, bytes32[2] signature) external returns (uint id);
    function submitBallotSignedWithEnc(bytes32 ballot, bytes32 curve25519PK, bytes32 ed25519PK, bytes32[2] signature) external returns (uint id);
}
