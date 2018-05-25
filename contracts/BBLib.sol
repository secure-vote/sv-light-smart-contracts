pragma solidity 0.4.24;


/**
 * This is a library to manage all ballot box functions. The idea is that
 * ballot box contracts should the the _minimum_ code required to be deployed
 * which means most (ideally all) functions should be moved here.
 */

import "./SVCommon.sol";
import { IxIface } from "./IndexInterface.sol";
import { BallotBoxIface } from "./BallotBoxIface.sol";
import { MemArrApp } from "../libs/MemArrApp.sol";
import { SVBallotConsts } from "./SVBallotConsts.sol";
import { BPackedUtils } from "./BPackedUtils.sol";

library BBLib {
    // ballot meta
    uint256 constant BB_VERSION = 3;

    // voting settings
    uint16 constant USE_ETH = 1;          // 2^0
    uint16 constant USE_SIGNED = 2;       // 2^1
    uint16 constant USE_NO_ENC = 4;       // 2^2
    uint16 constant USE_ENC = 8;          // 2^3

    // ballot settings
    uint16 constant IS_BINDING = 8192;    // 2^13
    uint16 constant IS_OFFICIAL = 16384;  // 2^14
    uint16 constant USE_TESTING = 32768;  // 2^15

    //// ** Storage Variables

    // struct for ballot
    struct Vote {
        bytes32 voteData;
        address sender;
        bytes32 encPK;
    }

    struct Sponsor {
        address sender;
        uint amount;
    }

    //// ** Events
    event CreatedBallot(bytes32 _specHash, uint64 startTs, uint64 endTs, uint16 submissionBits);
    event SuccessfulVote(address indexed voter, uint voteId);
    event SeckeyRevealed(bytes32 secretKey);
    event TestingEnabled();
    event DeprecatedContract();


    // The big database struct


    struct DB {
        // Maps to store ballots, along with corresponding log of voters.
        // Should only be modified through internal functions
        mapping (uint256 => Vote) votes;
        uint256 nVotesCast;

        mapping (address => uint256[]) voterLog;

        // NOTE - We don't actually want to include the encryption PublicKey because _it's included in the ballotSpec_.
        // It's better to ensure ppl actually have the ballot spec by not including it in the contract.
        // Plus we're already storing the hash of the ballotSpec anyway...

        // Private key to be set after ballot conclusion - curve25519
        bytes32 ballotEncryptionSeckey;

        // packed contains:
        // 1. Timestamps for start and end of ballot (UTC)
        // 2. bits used to decide which options are enabled or disabled for submission of ballots
        uint256 packed;

        // specHash by which to validate the ballots integrity
        bytes32 specHash;

        // allow tracking of sponsorship for this ballot & connection to index
        Sponsor[] sponsors;
        IxIface index;

        // deprecation flag - doesn't actually do anything besides signal that this contract is deprecated;
        bool deprecated;

        address ballotOwner;
    }


    // ** Modifiers -- note, these are functions here but allow us to use
    // smaller modifiers in BBInstance
    function requireBallotClosed(DB storage db) internal view {
        require(now > BPackedUtils.packedToEndTime(db.packed), "!b-closed");
    }

    function requireBallotOpen(DB storage db) external view {
        uint64 _n = uint64(now);
        uint64 startTs;
        uint64 endTs;
        (, startTs, endTs) = BPackedUtils.unpackAll(db.packed);
        require(_n >= startTs && _n < endTs, "!b-open");
        require(db.deprecated == false, "b-deprecated");
    }

    function requireBallotOwner(DB storage db) external view {
        require(msg.sender == db.ballotOwner, "!b-owner");
    }

    function requireTesting(DB storage db) external view {
        require(isTesting(BPackedUtils.packedToSubmissionBits(db.packed)), "!testing");
    }

    /* Functions */

    // "Constructor" function - init core params on deploy
    // timestampts are uint64s to give us plenty of room for millennia
    function init(DB storage db, bytes32 _specHash, uint256 _packed, IxIface ix, address ballotOwner) external {
        db.index = ix;
        db.ballotOwner = ballotOwner;

        uint64 startTs;
        uint64 endTs;
        uint16 sb;
        (sb, startTs, endTs) = BPackedUtils.unpackAll(_packed);
        require(endTs > now, "bad-end-time");

        // if we give bad submission bits (e.g. all 0s) then refuse to deploy ballot
        bool okaySubmissionBits = 1 == (isEthNoEnc(sb) ? 1 : 0) + (isEthWithEnc(sb) ? 1 : 0);
        require(okaySubmissionBits, "!valid-sb");

        // 0x1ff2 is 0001111111110010 in binary
        // by ANDing with subBits we make sure that only bits in positions 0,2,3,13,14,15
        // can be used. these correspond to the option flags at the top, and ETH ballots
        // that are enc'd or plaintext.
        require(sb & 0x1ff2 == 0, "bad-sb");

        bool _testing = isTesting(sb);
        if (_testing) {
            emit TestingEnabled();
        }
        db.specHash = _specHash;

        // take the max of the start time provided and the blocks timestamp to avoid a DoS against recent token holders
        // (which someone might be able to do if they could set the timestamp in the past)
        startTs = (_testing || startTs > now) ? startTs : uint64(now);

        db.packed = BPackedUtils.pack(sb, startTs, endTs);

        emit CreatedBallot(db.specHash, startTs, endTs, sb);
    }

    // // fallback function for sponsorship
    // function() external payable {
    //     totalSponsorship += msg.value;
    //     index.getPayTo().transfer(msg.value);
    // }

    function logSponsorship(DB storage db, uint value) internal {
        db.sponsors.push(Sponsor(msg.sender, value));
    }

    // // getters and constants

    function getVersion() internal pure returns (uint256) {
        return BB_VERSION;
    }

    function hasVotedEth(DB storage db, address v) external view returns (bool) {
        return db.voterLog[v].length > 0;
    }

    function getVote(DB storage db, uint id) external view returns (bytes32 voteData, address sender, bytes32 encPK) {
        return (db.votes[id].voteData, db.votes[id].sender, db.votes[id].encPK);
    }

    function getStartTime(DB storage db) public view returns (uint64) {
        return BPackedUtils.packedToStartTime(db.packed);
    }

    function getEndTime(DB storage db) public view returns (uint64) {
        return BPackedUtils.packedToEndTime(db.packed);
    }

    function getSubmissionBits(DB storage db) public view returns (uint16) {
        return BPackedUtils.packedToSubmissionBits(db.packed);
    }

    function getSpecHash(DB storage db) external view returns (bytes32) {
        return db.specHash;
    }

    function getTotalSponsorship(DB storage db) internal view returns (uint total) {
        for (uint i = 0; i < db.sponsors.length; i++) {
            total += db.sponsors[i].amount;
        }
    }

    function getSponsor(DB storage db, uint i) external view returns (address sender, uint amount) {
        sender = db.sponsors[i].sender;
        amount = db.sponsors[i].amount;
    }

    /* ETH BALLOTS */

    // Ballot submission
    // note: curve25519 keys should be generated for each ballot (then thrown away)
    function submitVote(DB storage db, bytes32 voteData, bytes32 encPK) external {
        _addVote(db, voteData, msg.sender, encPK);
    }

    function _addVote(DB storage db, bytes32 voteData, address sender, bytes32 encPK) internal returns (uint256 id) {
        id = db.nVotesCast;
        db.votes[id].voteData = voteData;
        db.votes[id].sender = sender;
        if (encPK != bytes32(0)) {
            db.votes[id].encPK = encPK;
        }
        db.nVotesCast += 1;
        db.voterLog[sender].push(id);
        emit SuccessfulVote(sender, id);
    }

    /* Admin */

    function setEndTime(DB storage db, uint64 newEndTime) external {
        uint16 sb;
        uint64 sTs;
        (sb, sTs,) = BPackedUtils.unpackAll(db.packed);
        db.packed = BPackedUtils.pack(sb, sTs, newEndTime);
    }

    function revealSeckey(DB storage db, bytes32 sk) internal {
        db.ballotEncryptionSeckey = sk;
        emit SeckeyRevealed(sk);
    }

    /* Submission Bits (Ballot Classifications) */

    // do (bits & SETTINGS_MASK) to get just operational bits (as opposed to testing or official flag)
    uint16 constant SETTINGS_MASK = 0xFFFF ^ USE_TESTING ^ IS_OFFICIAL ^ IS_BINDING;

    function unsafeIsEth(uint16 submissionBits) pure internal returns (bool) {
        // this is unsafe becuase it's not a valid configuration
        return USE_ETH & submissionBits != 0;
    }

    function unsafeIsSigned(uint16 submissionBits) pure internal returns (bool) {
        // unsafe bc it's not a valid configuration
        return USE_SIGNED & submissionBits != 0;
    }

    // function unsafeIsEncrypted() view internal returns (bool) {
    //     return USE_ENC & submissionBits != 0;
    // }

    function isEthNoEnc(uint16 submissionBits) pure internal returns (bool) {
        return checkFlags(submissionBits, USE_ETH | USE_NO_ENC);
    }

    function isEthWithEnc(uint16 submissionBits) pure internal returns (bool) {
        return checkFlags(submissionBits, USE_ETH | USE_ENC);
    }

    function isSignedNoEnc(uint16 submissionBits) pure internal returns (bool) {
        return checkFlags(submissionBits, USE_SIGNED | USE_NO_ENC);
    }

    function isSignedWithEnc(uint16 submissionBits) pure internal returns (bool) {
        return checkFlags(submissionBits, USE_SIGNED | USE_ENC);
    }

    function isOfficial(uint16 submissionBits) pure internal returns (bool) {
        return (submissionBits & IS_OFFICIAL) == IS_OFFICIAL;
    }

    function isBinding(uint16 submissionBits) pure internal returns (bool) {
        return (submissionBits & IS_BINDING) == IS_BINDING;
    }

    function isTesting(uint16 submissionBits) pure internal returns (bool) {
        return (submissionBits & USE_TESTING) == USE_TESTING;
    }

    function qualifiesAsCommunityBallot(uint16 submissionBits) pure internal returns (bool) {
        // if submissionBits AND any of the bits that make this _not_ a community
        // ballot is equal to zero that means none of those bits were active, so
        // it could be a community ballot
        return (submissionBits & (IS_BINDING | IS_OFFICIAL | USE_ENC)) == 0;
    }

    function checkFlags(uint16 submissionBits, uint16 expected) pure internal returns (bool) {
        // this should ignore ONLY the testing/flag bits - all other bits are significant
        uint16 sBitsNoSettings = submissionBits & SETTINGS_MASK;
        // then we want ONLY expected
        return sBitsNoSettings == expected;
    }
}
