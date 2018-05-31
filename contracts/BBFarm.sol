pragma solidity ^0.4.24;
pragma experimental ABIEncoderV2;

/**
 * BBFarm is a contract to use BBLib to replicate the functionality of
 * SVLightBallotBox within a centralised container (like the Index).
 */

import { BBLib } from "./BBLib.sol";
import { permissioned, payoutAllC } from "./SVCommon.sol";
import { IxIface } from "./IndexInterface.sol";
import "./BPackedUtils.sol";
import "./IxLib.sol";
import "../libs/MemArrApp.sol";

contract BBFarm is permissioned, payoutAllC {
    using BBLib for BBLib.DB;
    using IxLib for IxIface;

    bytes4 constant NAMESPACE = 0x00000000;

    mapping (uint => BBLib.DB) dbs;
    // note - start at 1 to avoid any test for if 0 is a valid ballotId
    uint nBallots = 1;

    event BallotCreatedWithID(uint ballotId);

    /* Constructor */

    constructor() public {

    }

    function getNamespace() external view returns (bytes4) {
        return bytes4(0);
    }

    /* Init ballot */

    function initBallot( bytes32 specHash
                       , uint256 packed
                       , IxIface ix
                       , address bbAdmin
                       , bytes32 extraData
                ) only_editors() external returns (uint ballotId) {
        // we need to call the init functions on our libraries
        ballotId = nBallots;
        dbs[ballotId].init(specHash, packed, ix, bbAdmin, extraData);
        nBallots = ballotId + 1;
        emit BallotCreatedWithID(uint256(NAMESPACE) << 40 ^ ballotId);
    }

    /* Sponsorship */

    function sponsor(uint ballotId) external payable {
        BBLib.DB storage db = dbs[ballotId];
        db.logSponsorship(msg.value);
        doSafeSend(db.index.getPayTo(), msg.value);
    }

    /* Voting */

    function submitVote(uint ballotId, bytes32 vote, bytes extra) external {
        BBLib.DB storage db = dbs[ballotId];
        db.requireBallotOpen();
        db.submitVote(vote, extra);
    }

    /* Getters */

    function getDetails(uint ballotId, address voter) external view returns
            ( bool hasVoted
            , uint nVotesCast
            , bytes32 secKey
            , uint16 submissionBits
            , uint64 startTime
            , uint64 endTime
            , bytes32 specHash
            , bool deprecated
            , address ballotOwner) {
        BBLib.DB storage db = dbs[ballotId];
        uint packed = db.packed;
        return (
            db.voterLog[voter].length > 0,
            db.nVotesCast,
            db.ballotEncryptionSeckey,
            BPackedUtils.packedToSubmissionBits(packed),
            BPackedUtils.packedToStartTime(packed),
            BPackedUtils.packedToEndTime(packed),
            db.specHash,
            db.deprecated,
            db.ballotOwner
        );
    }

    function getVersion() external pure returns (uint256) {
        return BBLib.getVersion();
    }

    function getVote(uint ballotId, uint voteId) external view returns (bytes32 voteData, address sender, bytes extra) {
        return dbs[ballotId].getVote(voteId);
    }

    function getTotalSponsorship(uint ballotId) external view returns (uint) {
        return dbs[ballotId].getTotalSponsorship();
    }

    function getSponsorsN(uint ballotId) external view returns (uint) {
        return dbs[ballotId].sponsors.length;
    }

    function getSponsor(uint ballotId, uint sponsorN) external view returns (address sender, uint amount) {
        return dbs[ballotId].getSponsor(sponsorN);
    }

    function getCreationTs(uint ballotId) external view returns (uint) {
        return dbs[ballotId].creationTs;
    }

    /* ADMIN */

    // Allow the owner to reveal the secret key after ballot conclusion
    function revealSeckey(uint ballotId, bytes32 sk) external {
        BBLib.DB storage db = dbs[ballotId];
        db.requireBallotOwner();
        db.requireBallotClosed();
        db.revealSeckey(sk);
    }

    function setEndTime(uint ballotId, uint64 newEndTime) external {
        // only_owner() onlyTesting()
        BBLib.DB storage db = dbs[ballotId];
        db.requireBallotOwner();
        db.requireTesting();
        db.setEndTime(newEndTime);
    }

    function setDeprecated(uint ballotId) external {
        BBLib.DB storage db = dbs[ballotId];
        db.requireBallotOwner();
        db.deprecated = true;
    }

    function setBallotOwner(uint ballotId, address newOwner) external {
        BBLib.DB storage db = dbs[ballotId];
        db.requireBallotOwner();
        db.ballotOwner = newOwner;
    }

    /* util functions - technically don't need to be in this contract (could
     * be run externally) - but easier to put here for the moment */

    function getVotes(uint ballotId) external view
        returns ( bytes32[] memory ballots
                , bytes[] memory extras
                , address[] memory senders) {

        address sender;
        bytes32 voteData;
        bytes memory extra;
        BBLib.DB storage db = dbs[ballotId];
        for (uint i = 0; i < db.nVotesCast; i++) {
            (voteData, sender, extra) = db.getVote(i);
            ballots = MemArrApp.appendBytes32(ballots, voteData);
            extras = MemArrApp.appendBytes(extras, extra);
            senders = MemArrApp.appendAddress(senders, sender);
        }
    }

    function getVotesFrom(uint ballotId, address voter) external view
        returns ( uint256[] memory ids
                , bytes32[] memory ballots
                , bytes[] memory extras) {

        address sender;
        bytes32 voteData;
        bytes memory extra;
        BBLib.DB storage db = dbs[ballotId];
        for (uint i = 0; i < db.nVotesCast; i++) {
            (voteData, sender, extra) = db.getVote(i);
            if (sender == voter) {
                ids = MemArrApp.appendUint256(ids, i);
                ballots = MemArrApp.appendBytes32(ballots, voteData);
                extras = MemArrApp.appendBytes(extras, extra);
            }
        }
    }
}
