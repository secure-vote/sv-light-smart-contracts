pragma solidity ^0.4.22;

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


contract SVLightBallotBox is descriptiveErrors, owned {
    //// ** Storage Variables

    // struct for ballot
    struct Ballot {
        bytes32 ballotData;
        // this should be an address or ed25519 pubkey depending
        bytes32 sender;
        // we use a uint32 here because addresses are 20 bytes and this might help
        // solidity pack the block number well. gives us a little room to expand too if needed.
        uint32 blockN;
    }

    // Maps to store ballots, along with corresponding log of voters.
    // Should only be modified through `addBallotAndVoter` internal function
    mapping (uint256 => Ballot) public ballotMap;
    mapping (uint256 => bytes32) public curve25519Pubkeys;
    mapping (uint256 => bytes32[2]) public ed25519Signatures;
    uint256 public nVotesCast = 0;

    // NOTE - We don't actually want to include the PublicKey because _it's included in the ballotSpec_.
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

    // deprecation flag - doesn't actually do anything besides signal that this contract is deprecated;
    bool public deprecated = false;

    //// ** Events
    event CreatedBallot(bytes32 _specHash, uint64 startTs, uint64 endTs, uint16 submissionBits);
    event SuccessfulVote(bytes32 indexed voter, uint ballotId);
    event SeckeyRevealed(bytes32 secretKey);
    event TestingEnabled();
    event DeprecatedContract();


    //// ** Modifiers

    modifier ballotOpen() {
        if(doRequire(uint64(block.timestamp) >= startTime && uint64(block.timestamp) < endTime, ERR_BALLOT_CLOSED))
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
        if (doRequire(isEthNoEnc(), ERR_NOT_BALLOT_ETH_NO_ENC))
            _;
    }

    modifier ballotIsEthWithEnc() {
        if (doRequire(isEthWithEnc(), ERR_NOT_BALLOT_ETH_WITH_ENC))
            _;
    }

    modifier ballotIsSignedNoEnc() {
        if (doRequire(isSignedNoEnc(), ERR_NOT_BALLOT_SIGNED_NO_ENC))
            _;
    }

    modifier ballotIsSignedWithEnc() {
        if (doRequire(isSignedWithEnc(), ERR_NOT_BALLOT_SIGNED_WITH_ENC))
            _;
    }

    //// ** Functions

    // Constructor function - init core params on deploy
    // timestampts are uint64s to give us plenty of room for millennia
    // flags are [_useEncryption, enableTesting]
    constructor(bytes32 _specHash, uint64 _startTs, uint64 endTs, uint16 _submissionBits) public {
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
        // add a rough prediction of what block is the starting block - approx 15s block times
        startingBlockAround = uint64((startTime - block.timestamp) / 15 + block.number);

        // take the max of the start time provided and the blocks timestamp to avoid a DoS against recent token holders
        // (which someone might be able to do if they could set the timestamp in the past)
        startTime = _testing ? _startTs : max(_startTs, uint64(block.timestamp));
        endTime = endTs;

        emit CreatedBallot(specHash, startTime, endTime, _submissionBits);
    }

    // Ballot submission
    function submitBallotNoPk(bytes32 ballot) ballotIsEthNoEnc() ballotOpen() public returns (uint id) {
        id = addBallot(ballot, bytes32(msg.sender));
        emit SuccessfulVote(bytes32(msg.sender), id);
    }

    // note: curve25519 keys should be generated for each ballot (then thrown away)
    function submitBallotWithPk(bytes32 ballot, bytes32 encPK) ballotIsEthWithEnc() ballotOpen() public returns (uint id) {
        id = addBallot(ballot, bytes32(msg.sender));
        curve25519Pubkeys[id] = encPK;
        emit SuccessfulVote(bytes32(msg.sender), id);
    }

    function submitBallotSignedNoEnc(bytes32 ballot, bytes32 ed25519PK, bytes32[2] signature) ballotIsSignedNoEnc() ballotOpen() public returns (uint id) {
        id = addBallot(ballot, ed25519PK);
        ed25519Signatures[id] = signature;
        emit SuccessfulVote(ed25519PK, id);
    }

    // note: curve25519 keys should be generated for each ballot (then thrown away)
    function submitBallotSignedWithEnc(bytes32 ballot, bytes32 curve25519PK, bytes32 ed25519PK, bytes32[2] signature) ballotIsSignedWithEnc() ballotOpen() public returns (uint id) {
        id = addBallot(ballot, ed25519PK);
        curve25519Pubkeys[id] = curve25519PK;
        ed25519Signatures[id] = signature;
        emit SuccessfulVote(ed25519PK, id);
    }

    function addBallot(bytes32 ballot, bytes32 sender) internal returns (uint256 id) {
        id = nVotesCast;
        ballotMap[id] = Ballot(ballot, sender, uint32(block.number));
        nVotesCast += 1;
    }

    // Allow the owner to reveal the secret key after ballot conclusion
    function revealSeckey(bytes32 _secKey) only_owner() req(block.timestamp > endTime, ERR_EARLY_SECKEY) public {
        ballotEncryptionSeckey = _secKey;
        seckeyRevealed = true; // this flag allows the contract to be locked
        emit SeckeyRevealed(_secKey);
    }

    function getEncSeckey() public constant returns (bytes32) {
        return ballotEncryptionSeckey;
    }

    // Test functions
    function setEndTime(uint64 newEndTime) onlyTesting() only_owner() public {
        endTime = newEndTime;
    }

    function setDeprecated() only_owner() public {
        deprecated = true;
        emit DeprecatedContract();
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

    uint16 constant USE_ETH = 1;
    uint16 constant USE_SIGNED = 2;
    uint16 constant USE_NO_ENC = 4;
    uint16 constant USE_ENC = 8;

    uint16 constant USE_TESTING = 32768;
    uint16 constant TESTING_MASK = 0xFFFF ^ USE_TESTING;  // do (bits & TESTING_MASK) to set testing bit to 0

    function isEthNoEnc() constant internal returns (bool) {
        uint16 expected = (USE_ETH | USE_NO_ENC) & TESTING_MASK;
        return checkFlags(expected);
    }

    function isEthWithEnc() constant internal returns (bool) {
        uint16 expected = (USE_ETH | USE_ENC) & TESTING_MASK;
        return checkFlags(expected);
    }

    function isSignedNoEnc() constant internal returns (bool) {
        uint16 expected = (USE_SIGNED | USE_NO_ENC) & TESTING_MASK;
        return checkFlags(expected);
    }

    function isSignedWithEnc() constant internal returns (bool) {
        uint16 expected = (USE_SIGNED | USE_ENC) & TESTING_MASK;
        return checkFlags(expected);
    }

    function isTesting() constant public returns (bool) {
        return submissionBits & USE_TESTING == USE_TESTING;
    }

    function checkFlags(uint16 expected) constant internal returns (bool) {
        // this should ignore ONLY the testing bit - all other bits are significant
        uint16 sBitsNoTesting = submissionBits & TESTING_MASK;
        // then we want ONLY expected
        return sBitsNoTesting == expected;
    }

    function checkBit(uint16 bitToTest) constant internal returns (bool) {
        // first remove the testing bit, then check the bitToTest
        return (submissionBits & TESTING_MASK) & bitToTest > 0;
    }
}
