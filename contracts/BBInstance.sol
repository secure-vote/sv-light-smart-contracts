pragma solidity ^0.4.24;

/**
 * This contract should be the minimum required to use BBLib to replicate
 * the functionality of SVLightBallotBox.
 */

import { BBLib } from "./BBLib.sol";
import { owned } from "./SVCommon.sol";
import { OwnedWLib } from "./SVLibs.sol";
import { IxIface } from "./IndexInterface.sol";
import { OwnedIface } from "./CommonIfaces.sol";
import { BallotBoxIface } from "./BallotBoxIface.sol";
import "./BPackedUtils.sol";
import "../libs/MemArrApp.sol";

contract BBInstance is BallotBoxIface, OwnedWLib {

    using BBLib for BBLib.DB;

    BBLib.DB db;

    modifier ballotEnded() {
        db.requireBallotEnded();
        _;
    }

    modifier onlyTesting() {
        require(BBLib.isTesting(db.getSubmissionBits()), "!testing");
        _;
    }

    /* Constructor */

    constructor(bytes32 specHash, uint256 packed, IxIface ix) public {
        // we need to call the init functions on our libraries
        db.init(specHash, packed, ix, msg.sender);
    }

    /* Fallback - Sponsorship */

    function() external payable {
        db.logSponsorship(msg.value);
        require(db.index.getPayTo().call.value(msg.value)(), "tx-fail");
    }

    /* Voting */

    function submitVote(bytes32 ballot, bytes32 encPK) external {
        db.requireBallotOpen();
        db.submitVote(ballot, encPK);
    }

    /* Getters */

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
            o.owner
        );
    }

    function getVersion() external pure returns (uint256) {
        return BBLib.getVersion();
    }

    function getVote(uint id) external view returns (bytes32 voteData, address sender, bytes32 encPK) {
        BBLib.Vote storage v = db.votes[id];
        return (v.voteData, v.sender, v.encPK);
    }

    function getTotalSponsorship() external view returns (uint) {
        return db.getTotalSponsorship();
    }

    /* ADMIN */

    // Allow the owner to reveal the secret key after ballot conclusion
    function revealSeckey(bytes32 sk) only_owner() ballotEnded() external {
        db.revealSeckey(sk);
    }

    function setEndTime(uint64 newEndTime) only_owner() onlyTesting() external {
        db.setEndTime(newEndTime);
    }

    function setDeprecated() only_owner() external {
        db.deprecated = true;
    }
}
