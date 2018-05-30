pragma solidity 0.4.24;

/**
 * Auxillary functions for ballots.
 * This hosts code that usually returns a memory array, but isn't stuff that
 * we want to bloat every ballot box with. e.g. `getBallotsEthFrom`
 */


import "./BallotBoxIface.sol";
import "./BBLib.sol";
import "./BPackedUtils.sol";
import "./BBFarm.sol";


contract BallotAux is BBAuxIface {
    address constant zeroAddr = address(0);

    function isTesting(BallotBoxIface bb) external view returns (bool) {
        return BBLib.isTesting(getSubmissionBits(bb));
    }

    function isOfficial(BallotBoxIface bb) external view returns (bool) {
        return BBLib.isOfficial(getSubmissionBits(bb));
    }

    function isBinding(BallotBoxIface bb) external view returns (bool) {
        return BBLib.isBinding(getSubmissionBits(bb));
    }

    function qualifiesAsCommunityBallot(BallotBoxIface bb) external view returns (bool) {
        return BBLib.qualifiesAsCommunityBallot(getSubmissionBits(bb));
    }

    function isDeprecated(BallotBoxIface bb) external view returns (bool deprecated) {
        (,,,,,,, deprecated,) = bb.getDetails(zeroAddr);
    }

    function getEncSeckey(BallotBoxIface bb) external view returns (bytes32 secKey) {
        (,, secKey,,,,,,) = bb.getDetails(zeroAddr);
    }

    function getSpecHash(BallotBoxIface bb) external view returns (bytes32 specHash) {
        (,,,,,, specHash,,) = bb.getDetails(zeroAddr);
    }

    function getSubmissionBits(BallotBoxIface bb) public view returns (uint16 submissionBits) {
        (,,, submissionBits,,,,,) = bb.getDetails(zeroAddr);
    }

    function getStartTime(BallotBoxIface bb) external view returns (uint64 startTime) {
        (,,,, startTime,,,,) = bb.getDetails(zeroAddr);
    }

    function getEndTime(BallotBoxIface bb) external view returns (uint64 endTime) {
        (,,,,, endTime,,,) = bb.getDetails(zeroAddr);
    }

    function getNVotesCast(BallotBoxIface bb) public view returns (uint256 nVotesCast) {
        (, nVotesCast,,,,,,,) = bb.getDetails(zeroAddr);
    }

    function hasVoted(BallotBoxIface bb, address voter) external view returns (bool hv) {
        ( hv,,,,,,,,) = bb.getDetails(voter);
    }

    // function getBallotOwner(BallotBoxIface bb) external view returns (address ballotOwner) {
    //     (,,,,,,,, ballotOwner) = bb.getDetails(zeroAddr);
    // }

    function getVotes(BallotBoxIface bb) external view
        returns ( bytes32[] memory ballots
                , bytes32[] memory pks
                , address[] memory senders) {

        address sender;
        bytes32 voteData;
        bytes32 encPK;
        for (uint i = 0; i < getNVotesCast(bb); i++) {
            (voteData, sender, encPK) = bb.getVote(i);
            ballots = MemArrApp.appendBytes32(ballots, voteData);
            pks = MemArrApp.appendBytes32(pks, encPK);
            senders = MemArrApp.appendAddress(senders, sender);
        }
    }

    function getVotesFrom(BallotBoxIface bb, address voter) external view
        returns ( uint256[] memory ids
                , bytes32[] memory ballots
                , bytes32[] memory pks) {

        address sender;
        bytes32 voteData;
        bytes32 encPK;
        for (uint i = 0; i < getNVotesCast(bb); i++) {
            (voteData, sender, encPK) = bb.getVote(i);
            if (sender == voter) {
                ids = MemArrApp.appendUint256(ids, i);
                ballots = MemArrApp.appendBytes32(ballots, voteData);
                pks = MemArrApp.appendBytes32(pks, encPK);
            }
        }
    }
}


contract BBFarmProxy {
    uint ballotId;
    BBFarm farm;

    constructor(BBFarm _farm, uint _ballotId) public {
        farm = _farm;
        ballotId = _ballotId;
    }

    function getVote(uint voteId) external view returns (bytes32, address, bytes32) {
        return farm.getVote(ballotId, voteId);
    }

    function getDetails(address voter) external view returns
            ( bool hasVoted
            , uint nVotesCast
            , bytes32 secKey
            , uint16 submissionBits
            , uint64 startTime
            , uint64 endTime
            , bytes32 specHash
            , bool deprecated
            , address ballotOwner) {
        return farm.getDetails(ballotId, voter);
    }
}
