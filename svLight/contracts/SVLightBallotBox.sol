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


contract SVLightBallotBox is descriptiveErrors, owned, BallotBoxIface {
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
    uint64 public startTime;
    uint64 public endTime;
    uint64 public creationBlock;
    uint64 public startingBlockAround;

    // specHash by which to validate the ballots integrity
    bytes32 public specHash;
    // bits used to decide which options are enabled or disabled for submission of ballots
    uint16 public submissionBits;

    // allow tracking of sponsorship for this ballot & connection to index
    uint totalSponsorship = 0;
    IxIface index;

    // deprecation flag - doesn't actually do anything besides signal that this contract is deprecated;
    bool public deprecated = false;

    //// ** Events
    event CreatedBallot(bytes32 _specHash, uint64 startTs, uint64 endTs, uint16 submissionBits);
    event SuccessfulVote(bytes32 indexed voter, uint ballotId);
    event SeckeyRevealed(bytes32 secretKey);
    event TestingEnabled();
    event DeprecatedContract();


    //// ** Modifiers

    function _reqBallotOpen() internal view {
        require(uint64(block.timestamp) >= startTime && uint64(block.timestamp) < endTime, "Ballot closed.");
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
    constructor(bytes32 _specHash, uint128 packedTimes, uint16 _submissionBits, IxIface ix) public {
        index = ix;

        // if we give bad submission bits (e.g. all 0s) then refuse to deploy ballot
        submissionBits = _submissionBits;
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
        uint64 _startTs = uint64(packedTimes >> 64);
        startTime = _testing ? _startTs : max(_startTs, uint64(block.timestamp));
        endTime = uint64(packedTimes);

        // add a rough prediction of what block is the starting block - approx 15s block times
        startingBlockAround = uint64((startTime - block.timestamp) / 15 + block.number);

        emit CreatedBallot(specHash, startTime, endTime, _submissionBits);
    }

    // fallback function for sponsorship
    function() external payable {
        totalSponsorship += msg.value;
        index.getPayTo().transfer(msg.value);
    }

    // getters and constants

    function getVersion() external constant returns (uint256) {
        return BB_VERSION;
    }

    function hasVotedEth(address v) external constant returns (bool) {
        return hasVotedMap[v];
    }

    function getBallotSigned(uint id) external constant returns (bytes32 ballotData, bytes32 sender, uint32 blockN) {
        return (ballotsSigned[id].ballotData, ballotsSigned[id].sender, ballotsSigned[id].blockN);
    }

    function getBallotEth(uint id) external constant returns (bytes32 ballotData, address sender, uint32 blockN) {
        return (ballotsEth[id].ballotData, ballotsEth[id].sender, ballotsEth[id].blockN);
    }

    function getPubkey(uint256 id) external constant returns (bytes32) {
        return curve25519Pubkeys[id];
    }

    function getSignature(uint256 id) external constant returns (bytes32[2]) {
        return ed25519Signatures[id];
    }

    /* ETH BALLOTS */

    // Ballot submission
    function submitBallotNoPk(bytes32 ballot) ballotIsEthNoEnc() external returns (uint id) {
        id = addBallotEth(ballot, msg.sender);
        emit SuccessfulVote(bytes32(msg.sender), id);
    }

    // note: curve25519 keys should be generated for each ballot (then thrown away)
    function submitBallotWithPk(bytes32 ballot, bytes32 encPK) ballotIsEthWithEnc() external returns (uint id) {
        id = addBallotEth(ballot, msg.sender);
        curve25519Pubkeys[id] = encPK;
        emit SuccessfulVote(bytes32(msg.sender), id);
    }

    function addBallotEth(bytes32 ballot, address sender) internal returns (uint256 id) {
        id = nVotesCast;
        ballotsEth[id] = BallotEth(ballot, sender, uint32(block.number));
        nVotesCast += 1;
        hasVotedMap[sender] = true;
    }

    /* NON-ETH BALLOTS */

    function submitBallotSignedNoEnc(bytes32 ballot, bytes32 ed25519PK, bytes32[2] signature) ballotIsSignedNoEnc() external returns (uint id) {
        id = addBallotSigned(ballot, ed25519PK);
        ed25519Signatures[id] = signature;
        emit SuccessfulVote(ed25519PK, id);
    }

    // note: curve25519 keys should be generated for each ballot (then thrown away)
    function submitBallotSignedWithEnc(bytes32 ballot, bytes32 curve25519PK, bytes32 ed25519PK, bytes32[2] signature) ballotIsSignedWithEnc() external returns (uint id) {
        id = addBallotSigned(ballot, ed25519PK);
        curve25519Pubkeys[id] = curve25519PK;
        ed25519Signatures[id] = signature;
        emit SuccessfulVote(ed25519PK, id);
    }

    function addBallotSigned(bytes32 ballot, bytes32 sender) internal returns (uint256 id) {
        id = nVotesCast;
        ballotsSigned[id] = BallotSigned(ballot, sender, uint32(block.number));
        nVotesCast += 1;
    }

    /* ADMIN STUFF */

    // Allow the owner to reveal the secret key after ballot conclusion
    function revealSeckey(bytes32 _secKey) only_owner() req(block.timestamp > endTime, ERR_EARLY_SECKEY) public {
        ballotEncryptionSeckey = _secKey;
        seckeyRevealed = true; // this flag allows the contract to be locked
        emit SeckeyRevealed(_secKey);
    }

    function getEncSeckey() external constant returns (bytes32) {
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

    function isDeprecated() external constant returns (bool) {
        return deprecated;
    }

    // utils
    function max(uint64 a, uint64 b) pure internal returns(uint64) {
        if (a > b) {
            return a;
        }
        return b;
    }

    // submission bits stuff
    // submission bits are structured as follows:

    uint16 constant USE_ETH = 1;    // 2^0
    uint16 constant USE_SIGNED = 2; // 2^1
    uint16 constant USE_NO_ENC = 4; // 2^2
    uint16 constant USE_ENC = 8;    // 2^3


    uint16 constant IS_OFFICIAL = 16384;  // 2^14
    uint16 constant USE_TESTING = 32768;  // 2^15
    uint16 constant SETTINGS_MASK = 0xFFFF ^ USE_TESTING ^ IS_OFFICIAL;  // do (bits & SETTINGS_MASK) to get just operational bits (as opposed to testing or official flag)

    function isEthNoEnc() constant internal returns (bool) {
        return checkFlags(USE_ETH | USE_NO_ENC);
    }

    function isEthWithEnc() constant internal returns (bool) {
        return checkFlags(USE_ETH | USE_ENC);
    }

    function isSignedNoEnc() constant internal returns (bool) {
        return checkFlags(USE_SIGNED | USE_NO_ENC);
    }

    function isSignedWithEnc() constant internal returns (bool) {
        return checkFlags(USE_SIGNED | USE_ENC);
    }

    function isOfficial() constant public returns (bool) {
        return (submissionBits & IS_OFFICIAL) == IS_OFFICIAL;
    }

    function isTesting() constant public returns (bool) {
        return (submissionBits & USE_TESTING) == USE_TESTING;
    }

    function checkFlags(uint16 expected) constant internal returns (bool) {
        // this should ignore ONLY the testing/flag bits - all other bits are significant
        uint16 sBitsNoSettings = submissionBits & SETTINGS_MASK;
        // then we want ONLY expected
        return sBitsNoSettings == expected;
    }

    // function checkBit(uint16 bitToTest) constant internal returns (bool) {
    //     // first remove the testing bit, then check the bitToTest
    //     return (submissionBits & SETTINGS_MASK) & bitToTest > 0;
    // }
}
