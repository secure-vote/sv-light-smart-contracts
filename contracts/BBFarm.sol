pragma solidity ^0.4.24;

/**
 * This contract should be the minimum required to use BBLib to replicate
 * the functionality of SVLightBallotBox.
 */

import { BBLib } from "./BBLib.sol";
import { hasAdmins } from "./SVCommon.sol";
import { OwnedWLib } from "./SVLibs.sol";
import { IxIface } from "./IndexInterface.sol";
import { OwnedIface } from "./CommonIfaces.sol";
import { BallotBoxIface } from "./BallotBoxIface.sol";
import "./BPackedUtils.sol";
import "../libs/MemArrApp.sol";

contract BBFarm is BallotBoxIface, hasAdmins {

    using BBLib for BBLib.DB;

    BBLib.DB db;

    modifier ballotEnded() {
        db.requireBallotEnded();
        _;
    }

    modifier ballotOpen() {
        db.requireBallotOpen();
        _;
    }

    modifier ballotIsEthNoEnc() {
        require(BBLib.isEthNoEnc(db.getSubmissionBits()), "!Eth-NoEnc");
        db.requireBallotOpen();
        _;
    }

    modifier ballotIsEthWithEnc() {
        require(BBLib.isEthWithEnc(db.getSubmissionBits()), "!Eth-Enc");
        db.requireBallotOpen();
        _;
    }

    modifier onlyTesting() {
        require(BBLib.isTesting(db.getSubmissionBits()), "!testing");
        _;
    }

    /* Constructor */

    constructor(bytes32 specHash, uint256 packed, IxIface ix, address bbAdmin) public {
        // we need to call the init functions on our libraries
        db.init(specHash, packed, ix);
        owner = bbAdmin;
    }

    /* Fallback - Sponsorship */

    function() external payable {
        db.handleSponsorship(msg.value);
        require(db.index.getPayTo().call.value(msg.value)(), "tx-fail");
    }

    /* Voting */

    function submitBallotNoPk(bytes32 ballot) external ballotIsEthNoEnc() {
        db.submitBallotNoPk(ballot);
    }

    function submitBallotWithPk(bytes32 ballot, bytes32 encPK) external ballotIsEthWithEnc() {
        db.submitBallotWithPk(ballot, encPK);
    }

    /* Getters */

    function getDetails(address voter) external view returns (bool hasVoted, uint nVotesCast, bytes32 secKey, uint16 submissionBits, uint64 startTime, uint64 endTime, bytes32 specHash, bool deprecated) {
        uint packed = db.packed;
        return (
            db.hasVotedMap[voter],
            db.nVotesCast,
            db.ballotEncryptionSeckey,
            BPackedUtils.packedToSubmissionBits(packed),
            BPackedUtils.packedToStartTime(packed),
            BPackedUtils.packedToEndTime(packed),
            db.specHash,
            db.deprecated
        );
    }

    function getVersion() external pure returns (uint256) {
        return BBLib.getVersion();
    }

    function getBallotEth(uint id) external view returns (bytes32 ballotData, address sender) {
        BBLib.BallotEth storage b = db.ballotsEth[id];
        return (b.ballotData, b.sender);
    }

    function getPubkey(uint256 id) external view returns (bytes32) {
        // NOTE: These are the curve25519 pks associated with encryption
        return db.curve25519Pubkeys[id];
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
