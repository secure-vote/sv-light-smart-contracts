pragma solidity 0.4.24;
pragma experimental ABIEncoderV2;

import "./BBFarmIface.sol";
import "../libs/MemArrApp.sol";

contract BBFarmAux {
    /* util functions - technically don't need to be in this contract (could
     * be run externally) - but easier to put here for the moment */

    // This is designed for v2 BBFarms

    function getVotes(BBFarmIface bbFarm, uint ballotId) external view
        returns ( bytes32[] memory votes
                , bytes[] memory extras
                , address[] memory senders) {

        uint nVotesCast;
        (, nVotesCast,,,,,,,,) = bbFarm.getDetails(ballotId, address(0));

        address sender;
        bytes32 vote;
        bytes memory extra;
        for (uint i = 0; i < nVotesCast; i++) {
            (vote, sender, extra) = bbFarm.getVote(ballotId, i);
            votes = MemArrApp.appendBytes32(votes, vote);
            extras = MemArrApp.appendBytes(extras, extra);
            senders = MemArrApp.appendAddress(senders, sender);
        }
    }

    function getVotesFrom(BBFarmIface bbFarm, uint ballotId, address providedVoter) external view
        returns ( uint256[] memory ids
                , bytes32[] memory votes
                , bytes[] memory extras) {

        uint nVotesCast;
        bool hasVoted;
        (hasVoted, nVotesCast,,,,,,,,) = bbFarm.getDetails(ballotId, providedVoter);

        if (!hasVoted) {
            // return empty arrays - if they voter hasn't voted no point looping through
            // everything...
            return (ids, votes, extras);
        }

        address voter;
        bytes32 vote;
        bytes memory extra;
        for (uint i = 0; i < nVotesCast; i++) {
            (vote, voter, extra) = bbFarm.getVote(ballotId, i);
            if (voter == providedVoter) {
                ids = MemArrApp.appendUint256(ids, i);
                votes = MemArrApp.appendBytes32(votes, vote);
                extras = MemArrApp.appendBytes(extras, extra);
            }
        }
    }
}
