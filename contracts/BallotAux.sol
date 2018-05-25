pragma solidity 0.4.24;

/**
 * Auxillary functions for ballots.
 * This hosts code that usually returns a memory array, but isn't stuff that
 * we want to bloat every ballot box with. e.g. `getBallotsEthFrom`
 */


import "./BallotBoxIface.sol";
import "./BBLib.sol";
import "./BPackedUtils.sol";


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

    function getBallotOwner(BallotBoxIface bb) external view returns (address ballotOwner) {
        (,,,,,,,,, ballotOwner) = bb.getDetails(zeroAddr);
    }

    function getBallots(BallotBoxIface bb) external view
        returns ( bytes32[] memory ballots
                , bytes32[] memory pks) {

        address sender;
        bytes32 ballotData;
        bytes32 encPK;
        for (uint i = 0; i < getNVotesCast(bb); i++) {
            (ballotData, sender, encPK) = bb.getVote(i);
            ballots = MemArrApp.appendBytes32(ballots, ballotData);
            pks = MemArrApp.appendBytes32(pks, encPK);
        }
    }

    function getBallotsFrom(BallotBoxIface bb, address voter) external view
        returns ( uint256[] memory ids
                , bytes32[] memory ballots
                , bytes32[] memory pks) {

        address sender;
        bytes32 ballotData;
        bytes32 encPK;
        for (uint i = 0; i < getNVotesCast(bb); i++) {
            (ballotData, sender, encPK) = bb.getVote(i);
            if (sender == voter) {
                ids = MemArrApp.appendUint256(ids, i);
                ballots = MemArrApp.appendBytes32(ballots, ballotData);
                pks = MemArrApp.appendBytes32(pks, encPK);
            }
        }
    }
}
