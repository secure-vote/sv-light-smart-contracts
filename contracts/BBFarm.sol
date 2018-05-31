pragma solidity ^0.4.24;

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
import "./BBFarmIface.sol";

contract BBFarm is permissioned, payoutAllC, BBFarmIface {
    using BBLib for BBLib.DB;
    using IxLib for IxIface;

    // this is only true for the initial BBFarm - others should not
    // use this namespace.
    bytes4 constant NAMESPACE = 0x00000000;

    uint constant VERSION = 2;

    mapping (uint => BBLib.DB) dbs;
    // note - start at 100 to avoid any test for if 0 is a valid ballotId
    // also gives us some space to play with low numbers if we want.
    uint constant INITIAL_BALLOT_ID_OFFSET = 100;
    uint nBallots = INITIAL_BALLOT_ID_OFFSET;

    event BallotCreatedWithID(uint ballotId);

    /* Constructor */

    constructor() public {
        // this bbFarm requires v4 of BBLib
        assert(BBLib.getVersion() == 4);
    }

    function getNamespace() external view returns (bytes4) {
        return NAMESPACE;
    }

    function getVersion() external view returns (uint) {
        return VERSION;
    }

    function getBBLibVersion() external view returns (uint256) {
        return BBLib.getVersion();
    }

    function getNBallots() external view returns (uint256) {
        return nBallots - INITIAL_BALLOT_ID_OFFSET;
    }

    /* Init ballot */

    function initBallot( bytes32 specHash
                       , uint256 packed
                       , IxIface ix
                       , address bbAdmin
                       , bytes24 extraData
                ) only_editors() external returns (uint) {
        // we need to call the init functions on our libraries
        uint ballotId = nBallots;
        dbs[ballotId].init(specHash, packed, ix, bbAdmin, extraData);
        nBallots = ballotId + 1;

        uint ballotIdWNamespace = uint256(NAMESPACE) << 40 ^ ballotId;
        emit BallotCreatedWithID(ballotIdWNamespace);

        return ballotIdWNamespace;
    }

    /* Sponsorship */

    function sponsor(uint ballotId) external payable {
        BBLib.DB storage db = dbs[ballotId];
        db.logSponsorship(msg.value);
        doSafeSend(db.index.getPayTo(), msg.value);
    }

    /* Voting */

    function submitVote(uint ballotId, bytes32 vote, bytes extra) external {
        dbs[ballotId].submitVote(vote, extra);
    }

    function submitProxyVote(uint ballotId, bytes32 vote, bytes extraWSig) external {
        dbs[ballotId].submitProxyVote(vote, extraWSig);
    }

    /* Getters */

    // note - this is the maxmimum number of vars we can return with one
    // function call (taking 2 args)
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
            , bytes24 extraData) {
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
            db.ballotOwner,
            db.extraData
        );
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

    // note: testing only.
    function setEndTime(uint ballotId, uint64 newEndTime) external {
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
