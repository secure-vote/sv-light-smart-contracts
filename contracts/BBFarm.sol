pragma solidity ^0.4.24;

/**
 * BBFarm is a contract to use BBLib to replicate the functionality of
 * SVLightBallotBox within a centralised container (like the Index).
 */

import { BBLib } from "./BBLib.sol";
import { permissioned } from "./SVCommon.sol";
import { OwnedWLib } from "./SVLibs.sol";
import { IxIface } from "./IndexInterface.sol";
import { OwnedIface } from "./CommonIfaces.sol";
import { BallotBoxIface } from "./BallotBoxIface.sol";
import "./BPackedUtils.sol";
import "../libs/MemArrApp.sol";

contract BBFarm is permissioned {

    using BBLib for BBLib.DB;

    mapping (uint => BBLib.DB) dbs;
    uint nBallots = 0;

    event BallotCreatedWithID(uint ballotId);

    /* Constructor */

    constructor() public {

    }

    /* Init ballot */

    function initBallot(bytes32 specHash, uint256 packed, IxIface ix, address bbAdmin) only_editors() external returns (uint ballotId) {
        // we need to call the init functions on our libraries
        ballotId = nBallots;
        dbs[ballotId].init(specHash, packed, ix, bbAdmin);
        nBallots = ballotId + 1;
        emit BallotCreatedWithID(ballotId);
    }

    /* Sponsorship */

    function sponsor(uint ballotId) external payable {
        BBLib.DB storage db = dbs[ballotId];
        db.logSponsorship(msg.value);
        require(db.index.getPayTo().call.value(msg.value)(), "tx-fail");
    }

    /* Voting */

    function submitVote(uint ballotId, bytes32 vote, bytes32 encPK) external {
        BBLib.DB storage db = dbs[ballotId];
        db.requireBallotOpen();
        db.submitVote(vote, encPK);
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

    function getVote(uint ballotId, uint voteId) external view returns (bytes32 voteData, address sender, bytes32 encPK) {
        BBLib.Vote storage b = dbs[ballotId].votes[voteId];
        return (b.voteData, b.sender, b.encPK);
    }

    function getTotalSponsorship(uint ballotId) external view returns (uint) {
        return dbs[ballotId].getTotalSponsorship();
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
}
