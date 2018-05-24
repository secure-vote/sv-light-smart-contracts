pragma solidity ^0.4.24;

interface BallotBoxIface {
    function getVersion() external pure returns (uint256);

    function getBallotEth(uint256) external view returns (bytes32 ballotData, address sender);
    function getPubkey(uint256) external view returns (bytes32);

    function getDetails(address voter) external view returns (
        bool hasVoted,
        uint nVotesCast,
        bytes32 secKey,
        uint16 submissionBits,
        uint64 startTime,
        uint64 endTime,
        bytes32 specHash,
        bool deprecated);

    function getTotalSponsorship() external view returns (uint);

    function submitBallotNoPk(bytes32 ballot) external;
    function submitBallotWithPk(bytes32 ballot, bytes32 encPK) external;

    function revealSeckey(bytes32 sk) external;
    function setEndTime(uint64 newEndTime) external;
    function setDeprecated() external;

    function setOwner(address) external;
    function getOwner() external view returns (address);
}


interface BBAuxIface {
    function isTesting(BallotBoxIface bb) external view returns (bool);
    function isOfficial(BallotBoxIface bb) external view returns (bool);
    function isBinding(BallotBoxIface bb) external view returns (bool);
    function qualifiesAsCommunityBallot(BallotBoxIface bb) external view returns (bool);


    function isDeprecated(BallotBoxIface bb) external view returns (bool);
    function getEncSeckey(BallotBoxIface bb) external view returns (bytes32);
    function getSpecHash(BallotBoxIface bb) external view returns (bytes32);
    function getSubmissionBits(BallotBoxIface bb) external view returns (uint16);
    function getStartTime(BallotBoxIface bb) external view returns (uint64);
    function getEndTime(BallotBoxIface bb) external view returns (uint64);
    function getNVotesCast(BallotBoxIface bb) external view returns (uint256 nVotesCast);

    function hasVoted(BallotBoxIface bb, address voter) external view returns (bool hv);

    function getBallots(BallotBoxIface bb) external view
        returns ( bytes32[] memory ballots
                , bytes32[] memory pks);

    function getBallotsFrom(BallotBoxIface bb, address voter) external view
        returns ( bytes32[] memory ballots
                , bytes32[] memory pks);
}
