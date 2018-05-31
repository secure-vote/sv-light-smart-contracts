pragma solidity 0.4.24;


/**
 * Interface for a BBFarm
 */


import "./IndexInterface.sol";


interface BBFarmIface {
    /* from permissioned */

    function upgradeMe(address newSC) external;

    /* global bbfarm getters */

    function getNamespace() external view returns (bytes4);
    function getVersion() external view returns (uint);
    function getBBLibVersion() external view returns (uint256);
    function getNBallots() external view returns (uint256);

    /* init a ballot */

    // note that the ballotId returned INCLUDES the namespace.
    function initBallot( bytes32 specHash
                       , uint256 packed
                       , IxIface ix
                       , address bbAdmin
                       , bytes24 extraData
                ) external returns (uint ballotIdWNamespace);

    /* Sponsorship of ballots */

    function sponsor(uint ballotId) external payable;

    /* Voting functions */

    function submitVote(uint ballotId, bytes32 vote, bytes extra) external;
    function submitProxyVote(uint ballotId, bytes32 voteData, bytes extraWSig) external;

    /* Ballot Getters */

    function getDetails(uint ballotId, address voter) external view returns
            ( bool hasVoted
            , uint nVotesCast
            , bytes32 secKey
            , uint16 submissionBits
            , uint64 startTime
            , uint64 endTime
            , bytes32 specHash
            , bool deprecated
            , address ballotOwner
            , bytes24 extraData);

    function getVote(uint ballotId, uint voteId) external view returns (bytes32 voteData, address sender, bytes extra);
    function getTotalSponsorship(uint ballotId) external view returns (uint);
    function getSponsorsN(uint ballotId) external view returns (uint);
    function getSponsor(uint ballotId, uint sponsorN) external view returns (address sender, uint amount);
    function getCreationTs(uint ballotId) external view returns (uint);

    /* Admin on ballots */
    function revealSeckey(uint ballotId, bytes32 sk) external;
    function setEndTime(uint ballotId, uint64 newEndTime) external;  // note: testing only
    function setDeprecated(uint ballotId) external;
    function setBallotOwner(uint ballotId, address newOwner) external;
}
