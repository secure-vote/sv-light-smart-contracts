pragma solidity ^0.4.24;

interface BallotBoxIface {
    function getVersion() external pure returns (uint256);

    function getVote(uint256) external view returns (bytes32 voteData, address sender, bytes32 encPK);

    function getDetails(address voter) external view returns (
        bool hasVoted,
        uint nVotesCast,
        bytes32 secKey,
        uint16 submissionBits,
        uint64 startTime,
        uint64 endTime,
        bytes32 specHash,
        bool deprecated,
        address ballotOwner);

    function getTotalSponsorship() external view returns (uint);

    function submitVote(bytes32 voteData, bytes32 encPK) external;

    function revealSeckey(bytes32 sk) external;
    function setEndTime(uint64 newEndTime) external;
    function setDeprecated() external;

    function setOwner(address) external;
    function getOwner() external view returns (address);

    event CreatedBallot(bytes32 specHash, uint64 startTs, uint64 endTs, uint16 submissionBits);
    event SuccessfulVote(address indexed voter, uint voteId);
    event SeckeyRevealed(bytes32 secretKey);
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

    function getVotes(BallotBoxIface bb) external view
        returns ( bytes32[] memory ballots
                , bytes32[] memory pks);

    function getVotesFrom(BallotBoxIface bb, address voter) external view
        returns ( uint256[] memory ids
                , bytes32[] memory ballots
                , bytes32[] memory pks);
}
