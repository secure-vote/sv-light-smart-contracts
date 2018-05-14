pragma solidity ^0.4.23;

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


contract BBSettings {
    // voting settings
    uint16 constant USE_ETH = 1;          // 2^0
    uint16 constant USE_SIGNED = 2;       // 2^1
    uint16 constant USE_NO_ENC = 4;       // 2^2
    uint16 constant USE_ENC = 8;          // 2^3

    // ballot settings
    uint16 constant IS_BINDING = 8192;    // 2^13
    uint16 constant IS_OFFICIAL = 16384;  // 2^14
    uint16 constant USE_TESTING = 32768;  // 2^15
}


contract SVLightBallotBox is BallotBoxIface, BBSettings, descriptiveErrors, owned {
    uint256 constant BB_VERSION = 3;

    //// ** Storage Variables

    // struct for ballot
    struct BallotSigned {
        bytes32 ballotData;
        bytes32 sender;
        uint32 blockN;
    }

    struct BallotEth {
        bytes32 ballotData;
        address sender;
        uint32 blockN;
    }

    // Maps to store ballots, along with corresponding log of voters.
    // Should only be modified through `addBallotAndVoter` internal function
    mapping (uint256 => BallotSigned) public ballotsSigned;
    mapping (uint256 => BallotEth) public ballotsEth;
    mapping (uint256 => bytes32) public curve25519Pubkeys;
    mapping (uint256 => bytes32[2]) public ed25519Signatures;
    uint256 public nVotesCast = 0;

    mapping (address => bool) hasVotedMap;

    // NOTE - We don't actually want to include the encryption PublicKey because _it's included in the ballotSpec_.
    // It's better to ensure ppl actually have the ballot spec by not including it in the contract.
    // Plus we're already storing the hash of the ballotSpec anyway...

    // Private key to be set after ballot conclusion - curve25519
    bytes32 public ballotEncryptionSeckey;
    bool seckeyRevealed = false;

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

    // NOTE: the ballotIs<A>With<B> modifiers call _reqBallotOpen() too,
    // so ballotOpen() isn't needed when using those modifiers
    modifier ballotOpen() {
        _reqBallotOpen();
        _;
    }

    modifier onlyTesting() {
        if(doRequire(isTesting(), ERR_TESTING_REQ))
            _;
    }

    modifier isTrue(bool _b) {
        if(doRequire(_b == true, ERR_500))
            _;
    }

    modifier isFalse(bool _b) {
        if(doRequire(_b == false, ERR_500))
            _;
    }

    modifier ballotIsEthNoEnc() {
        require(isEthNoEnc(), ERR_NOT_BALLOT_ETH_NO_ENC);
        _reqBallotOpen();
        _;
    }

    modifier ballotIsEthWithEnc() {
        require(isEthWithEnc(), ERR_NOT_BALLOT_ETH_WITH_ENC);
        _reqBallotOpen();
        _;
    }

    modifier ballotIsSignedNoEnc() {
        require(isSignedNoEnc(), ERR_NOT_BALLOT_SIGNED_NO_ENC);
        _reqBallotOpen();
        _;
    }

    modifier ballotIsSignedWithEnc() {
        require(isSignedWithEnc(), ERR_NOT_BALLOT_SIGNED_WITH_ENC);
        _reqBallotOpen();
        _;
    }

    //// ** Functions

    // Constructor function - init core params on deploy
    // timestampts are uint64s to give us plenty of room for millennia
    constructor(bytes32 _specHash, uint256 packed, IxIface ix) public {
        index = ix;

        // if we give bad submission bits (e.g. all 0s) then refuse to deploy ballot
        submissionBits = uint16(packed >> 128);
        bool okaySubmissionBits = isEthNoEnc() || isEthWithEnc() || isSignedNoEnc() || isSignedWithEnc();
        if (!doRequire(okaySubmissionBits, ERR_BAD_SUBMISSION_BITS)) {
            revert();
        }

        bool _testing = isTesting();
        if (_testing) {
            emit TestingEnabled();
        }
        specHash = _specHash;
        creationBlock = uint64(block.number);

        // take the max of the start time provided and the blocks timestamp to avoid a DoS against recent token holders
        // (which someone might be able to do if they could set the timestamp in the past)
        uint64 _startTs = uint64(packed >> 64);
        startTime = _testing ? _startTs : maxU64(_startTs, uint64(now));
        endTime = uint64(packed);

        emit CreatedBallot(specHash, startTime, endTime, submissionBits);
    }

    // fallback function for sponsorship
    function() external payable {
        totalSponsorship += msg.value;
        index.getPayTo().transfer(msg.value);
    }

    // getters and constants

    function getVersion() external view returns (uint256) {
        return BB_VERSION;
    }

    function hasVotedEth(address v) external view returns (bool) {
        return hasVotedMap[v];
    }

    function getBallotSigned(uint id) external view returns (bytes32 ballotData, bytes32 sender, uint32 blockN) {
        return (ballotsSigned[id].ballotData, ballotsSigned[id].sender, ballotsSigned[id].blockN);
    }

    function getBallotEth(uint id) external view returns (bytes32 ballotData, address sender, uint32 blockN) {
        return (ballotsEth[id].ballotData, ballotsEth[id].sender, ballotsEth[id].blockN);
    }

    function getPubkey(uint256 id) external view returns (bytes32) {
        // NOTE: These are the curve25519 pks associated with encryption
        return curve25519Pubkeys[id];
    }

    function getSignature(uint256 id) external view returns (bytes32[2]) {
        // NOTE: these are ed25519 signatures associated with signed ballots
        return ed25519Signatures[id];
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

    function getBallotsEthFrom(address voter) external view
        returns ( uint[] memory ids
                , bytes32[] memory ballots
                , uint32[] memory blockNs
                , bytes32[] memory pks
                , bytes32[2][] memory sigs
                , bool authenticated) {
        // ids = new uint[](0);
        // ballots = new bytes32[](0);
        // blockNs = new uint32[](0);
        // pks = new bytes32[](0);
        // sigs = new bytes32[2][](0);
        authenticated = true;

        for (uint i = 0; i < nVotesCast; i++) {
            if (ballotsEth[i].sender == voter) {
                ids = MemArrApp.appendUint256(ids, i);
                ballots = MemArrApp.appendBytes32(ballots, ballotsEth[i].ballotData);
                blockNs = MemArrApp.appendUint32(blockNs, ballotsEth[i].blockN);
                pks = MemArrApp.appendBytes32(pks, curve25519Pubkeys[i]);
                sigs = MemArrApp.appendBytes32Pair(sigs, ed25519Signatures[i]);
            }
        }
    }

    function getBallotsSignedFrom(bytes32 voter) external view
        returns ( uint[] memory ids
                , bytes32[] memory ballots
                , uint32[] memory blockNs
                , bytes32[] memory pks
                , bytes32[2][] memory sigs
                , bool authenticated) {
        // ids = new uint[](0);
        // ballots = new bytes32[](0);
        // blockNs = new uint32[](0);
        // pks = new bytes32[](0);
        // sigs = new bytes32[2][](0);
        authenticated = false;

        for (uint i = 0; i < nVotesCast; i++) {
            if (ballotsSigned[i].sender == voter) {
                ids = MemArrApp.appendUint256(ids, i);
                ballots = MemArrApp.appendBytes32(ballots, ballotsSigned[i].ballotData);
                blockNs = MemArrApp.appendUint32(blockNs, ballotsSigned[i].blockN);
                pks = MemArrApp.appendBytes32(pks, curve25519Pubkeys[i]);
                sigs = MemArrApp.appendBytes32Pair(sigs, ed25519Signatures[i]);
            }
        }
    }

    /* ETH BALLOTS */

    // Ballot submission
    function submitBallotNoPk(bytes32 ballot) ballotIsEthNoEnc() external returns (uint id) {
        id = _addBallotEth(ballot, msg.sender);
        emit SuccessfulVote(bytes32(msg.sender), id);
    }

    // note: curve25519 keys should be generated for each ballot (then thrown away)
    function submitBallotWithPk(bytes32 ballot, bytes32 encPK) ballotIsEthWithEnc() external returns (uint id) {
        id = _addBallotEth(ballot, msg.sender);
        curve25519Pubkeys[id] = encPK;
        emit SuccessfulVote(bytes32(msg.sender), id);
    }

    function _addBallotEth(bytes32 ballot, address sender) internal returns (uint256 id) {
        id = nVotesCast;
        ballotsEth[id] = BallotEth(ballot, sender, uint32(block.number));
        nVotesCast += 1;
        hasVotedMap[sender] = true;
    }

    /* NON-ETH BALLOTS */

    function submitBallotSignedNoEnc(bytes32 ballot, bytes32 ed25519PK, bytes32[2] signature) ballotIsSignedNoEnc() external returns (uint id) {
        id = _addBallotSigned(ballot, ed25519PK);
        ed25519Signatures[id] = signature;
        emit SuccessfulVote(ed25519PK, id);
    }

    // note: curve25519 keys should be generated for each ballot (then thrown away)
    function submitBallotSignedWithEnc(bytes32 ballot, bytes32 curve25519PK, bytes32 ed25519PK, bytes32[2] signature) ballotIsSignedWithEnc() external returns (uint id) {
        id = _addBallotSigned(ballot, ed25519PK);
        curve25519Pubkeys[id] = curve25519PK;
        ed25519Signatures[id] = signature;
        emit SuccessfulVote(ed25519PK, id);
    }

    function _addBallotSigned(bytes32 ballot, bytes32 sender) internal returns (uint256 id) {
        id = nVotesCast;
        ballotsSigned[id] = BallotSigned(ballot, sender, uint32(block.number));
        nVotesCast += 1;
    }

    /* ADMIN STUFF */

    // Allow the owner to reveal the secret key after ballot conclusion
    function revealSeckey(bytes32 _secKey) only_owner() req(now > endTime, ERR_EARLY_SECKEY) public {
        ballotEncryptionSeckey = _secKey;
        seckeyRevealed = true; // this flag allows the contract to be locked
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

    function checkFlags(uint16 expected) view internal returns (bool) {
        // this should ignore ONLY the testing/flag bits - all other bits are significant
        uint16 sBitsNoSettings = submissionBits & SETTINGS_MASK;
        // then we want ONLY expected
        return sBitsNoSettings == expected;
    }

    // function checkBit(uint16 bitToTest) view internal returns (bool) {
    //     // first remove the testing bit, then check the bitToTest
    //     return (submissionBits & SETTINGS_MASK) & bitToTest > 0;
    // }
}
