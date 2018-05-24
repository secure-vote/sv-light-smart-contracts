pragma solidity ^0.4.24;

//
// SVLightBallotBox
// Single use contract to manage a ballot
// Author: Max Kaye <max@secure.vote>
// License: MIT
// version: v1.2.0 [WIP]
//
// Architecture:
// * Ballot authority declares public key with which to encrypt ballots (optional - stored in ballot spec)
// * Users submit encrypted or plaintext ballots as blobs (dependent on above)
// * These ballots are tracked by the ETH address of the sender
// * Following the conclusion of the ballot, the secret key is provided
//   by the ballot authority, and all users may transparently and
//   independently validate the results
//
// Notes:
// * Since ballots are encrypted the only validation we can do is length, but UI takes care of most of the rest
//
//


import "./SVCommon.sol";
import { IxIface } from "./IndexInterface.sol";
import { BallotBoxIface } from "./BallotBoxIface.sol";
import { MemArrApp } from "../libs/MemArrApp.sol";
import { SVBallotConsts } from "./SVBallotConsts.sol";
import { BPackedUtils } from "../libs/BPackedUtils.sol";


contract SVLightBallotBox is BallotBoxIface, SVBallotConsts, owned {
    uint256 constant BB_VERSION = 3;

    //// ** Storage Variables

    // struct for ballot
    struct BallotEth {
        bytes32 ballotData;
        address sender;
        uint32 blockN;
    }

    // Maps to store ballots, along with corresponding log of voters.
    // Should only be modified through `addBallotAndVoter` internal function
    mapping (uint256 => BallotEth) public ballotsEth;
    mapping (uint256 => bytes32) public curve25519Pubkeys;
    uint256 public nVotesCast = 0;

    mapping (address => bool) hasVotedMap;

    // NOTE - We don't actually want to include the encryption PublicKey because _it's included in the ballotSpec_.
    // It's better to ensure ppl actually have the ballot spec by not including it in the contract.
    // Plus we're already storing the hash of the ballotSpec anyway...

    // Private key to be set after ballot conclusion - curve25519
    bytes32 ballotEncryptionSeckey;

    // Timestamps for start and end of ballot (UTC)
    uint64 startTime;
    uint64 endTime;
    uint64 creationBlock;

    // specHash by which to validate the ballots integrity
    bytes32 specHash;
    // bits used to decide which options are enabled or disabled for submission of ballots
    uint16 submissionBits;

    // allow tracking of sponsorship for this ballot & connection to index
    uint totalSponsorship = 0;
    IxIface index;

    // deprecation flag - doesn't actually do anything besides signal that this contract is deprecated;
    bool deprecated = false;

    //// ** Events
    event CreatedBallot(bytes32 _specHash, uint64 startTs, uint64 endTs, uint16 submissionBits);
    event SuccessfulVote(bytes32 indexed voter, uint ballotId);
    event SeckeyRevealed(bytes32 secretKey);
    event TestingEnabled();
    event DeprecatedContract();


    //// ** Modifiers

    function _reqBallotOpen() internal view {
        uint64 _n = uint64(now);
        require(_n >= startTime && _n < endTime, "Ballot closed.");
        require(deprecated == false, "This ballot has been marked deprecated");
    }

    modifier onlyTesting() {
        require(isTesting(), "ballot is not in testing mode");
        _;
    }

    modifier ballotIsEthNoEnc() {
        require(isEthNoEnc(), "ballot is not of type Eth-NoEnc");
        _reqBallotOpen();
        _;
    }

    modifier ballotIsEthWithEnc() {
        require(isEthWithEnc(), "ballot is not of type Eth-Enc");
        _reqBallotOpen();
        _;
    }

    //// ** Functions

    // Constructor function - init core params on deploy
    // timestampts are uint64s to give us plenty of room for millennia
    constructor(bytes32 _specHash, uint256 packed, IxIface ix) public {
        index = ix;

        uint64 _startTs;
        (submissionBits, _startTs, endTime) = BPackedUtils.unpackAll(packed);

        // if we give bad submission bits (e.g. all 0s) then refuse to deploy ballot
        // check by converting bools to 0 or 1 and summing, making sure the result
        // is 1.
        bool validSubmissionBits = (isEthNoEnc() ? 1 : 0) + (isEthWithEnc() ? 1 : 0) == 1;
        require(validSubmissionBits, "submission bits not valid");
        // 0x1ff2 is 0001111111110010 in binary
        // by ANDing with subBits we make sure that only bits in positions 0,2,3,13,14,15
        // can be used. these correspond to the option flags at the top, and ETH ballots
        // that are enc'd or plaintext.
        require(submissionBits & 0x1ff2 == 0, "banned sub bits");

        bool _testing = isTesting();
        if (_testing) {
            emit TestingEnabled();
        }
        specHash = _specHash;
        creationBlock = uint64(block.number);

        // take the max of the start time provided and the blocks timestamp to avoid a DoS against recent token holders
        // (which someone might be able to do if they could set the timestamp in the past)
        startTime = _testing ? _startTs : maxU64(_startTs, uint64(now));

        emit CreatedBallot(specHash, startTime, endTime, submissionBits);
    }

    // fallback function for sponsorship
    function() external payable {
        totalSponsorship += msg.value;
        index.getPayTo().transfer(msg.value);
    }

    // getters and constants

    function getDetails(address voter) external view returns (bool hasVoted, uint, bytes32 secKey, uint16, uint64, uint64, bytes32, bool) {
        hasVoted = hasVotedMap[voter];
        secKey = ballotEncryptionSeckey;
        return (
            hasVoted,
            nVotesCast,
            secKey,
            submissionBits,
            startTime,
            endTime,
            specHash,
            deprecated
        );
    }

    function getVersion() external pure returns (uint256) {
        return BB_VERSION;
    }

    function getNVotesCast() external view returns (uint) {
        return nVotesCast;
    }

    function hasVotedEth(address v) external view returns (bool) {
        return hasVotedMap[v];
    }


    function getBallotEth(uint id) external view returns (bytes32 ballotData, address sender) {
        return (ballotsEth[id].ballotData, ballotsEth[id].sender);
    }

    function getPubkey(uint256 id) external view returns (bytes32) {
        // NOTE: These are the curve25519 pks associated with encryption
        return curve25519Pubkeys[id];
    }

    function getStartTime() external view returns (uint64) {
        return startTime;
    }

    function getEndTime() external view returns (uint64) {
        return endTime;
    }

    function getSubmissionBits() external view returns (uint16) {
        return submissionBits;
    }

    function getCreationBlock() external view returns (uint64) {
        return creationBlock;
    }

    function getSpecHash() external view returns (bytes32) {
        return specHash;
    }

    function getTotalSponsorship() external view returns (uint) {
        return totalSponsorship;
    }

    /* ETH BALLOTS */

    // Ballot submission
    function submitBallotNoPk(bytes32 ballot) ballotIsEthNoEnc() external {
        _addBallotEth(ballot, msg.sender);
    }

    // note: curve25519 keys should be generated for each ballot (then thrown away)
    function submitBallotWithPk(bytes32 ballot, bytes32 encPK) ballotIsEthWithEnc() external {
        curve25519Pubkeys[_addBallotEth(ballot, msg.sender)] = encPK;
    }

    function _addBallotEth(bytes32 ballot, address sender) internal returns (uint256 id) {
        id = nVotesCast;
        ballotsEth[id] = BallotEth(ballot, sender, uint32(block.number));
        nVotesCast += 1;
        hasVotedMap[sender] = true;
        emit SuccessfulVote(bytes32(msg.sender), id);
    }

    /* ADMIN STUFF */

    // Allow the owner to reveal the secret key after ballot conclusion
    function revealSeckey(bytes32 _secKey) only_owner() public {
        require(now > endTime, "secret key cannot be released early");
        ballotEncryptionSeckey = _secKey;
        emit SeckeyRevealed(_secKey);
    }

    function getEncSeckey() external view returns (bytes32) {
        return ballotEncryptionSeckey;
    }

    // Test functions
    function setEndTime(uint64 newEndTime) onlyTesting() only_owner() public {
        endTime = newEndTime;
    }

    // red button for deprecation
    function setDeprecated() only_owner() public {
        deprecated = true;
        emit DeprecatedContract();
    }

    function isDeprecated() external view returns (bool) {
        return deprecated;
    }

    // utils
    function maxU64(uint64 a, uint64 b) pure internal returns(uint64) {
        if (a > b) {
            return a;
        }
        return b;
    }

    // submission bits stuff
    // submission bits are structured as follows:

    // do (bits & SETTINGS_MASK) to get just operational bits (as opposed to testing or official flag)
    uint16 constant SETTINGS_MASK = 0xFFFF ^ USE_TESTING ^ IS_OFFICIAL ^ IS_BINDING;

    function unsafeIsEth() view internal returns (bool) {
        // this is unsafe becuase it's not a valid configuration
        return USE_ETH & submissionBits == USE_ETH;
    }

    function unsafeIsSigned() view internal returns (bool) {
        // unsafe bc it's not a valid configuration
        return USE_SIGNED & submissionBits == USE_SIGNED;
    }

    // function unsafeIsEncrypted() view internal returns (bool) {
    //     return USE_ENC & submissionBits != 0;
    // }

    function isEthNoEnc() view internal returns (bool) {
        return checkFlags(USE_ETH | USE_NO_ENC);
    }

    function isEthWithEnc() view internal returns (bool) {
        return checkFlags(USE_ETH | USE_ENC);
    }

    function isSignedNoEnc() view internal returns (bool) {
        return checkFlags(USE_SIGNED | USE_NO_ENC);
    }

    function isSignedWithEnc() view internal returns (bool) {
        return checkFlags(USE_SIGNED | USE_ENC);
    }

    function isOfficial() view public returns (bool) {
        return (submissionBits & IS_OFFICIAL) == IS_OFFICIAL;
    }

    function isBinding() view public returns (bool) {
        return (submissionBits & IS_BINDING) == IS_BINDING;
    }

    function isTesting() view public returns (bool) {
        return (submissionBits & USE_TESTING) == USE_TESTING;
    }

    function qualifiesAsCommunityBallot() view external returns (bool) {
        // if submissionBits AND any of the bits that make this _not_ a community
        // ballot is equal to zero that means none of those bits were active, so
        // it could be a community ballot
        return (submissionBits & (IS_BINDING | IS_OFFICIAL | USE_ENC)) == 0;
    }

    function checkFlags(uint16 expected) view internal returns (bool) {
        // this should ignore ONLY the testing/flag bits - all other bits are significant
        uint16 sBitsNoSettings = submissionBits & SETTINGS_MASK;
        // then we want ONLY expected
        return sBitsNoSettings == expected;
    }

    function countTrue(bool[] memory bools) pure internal returns (uint n) {
        n = 0;
        for (uint256 i = 0; i < bools.length; i++) {
            if (bools[i]) {
                n += 1;
            }
        }
    }
}
