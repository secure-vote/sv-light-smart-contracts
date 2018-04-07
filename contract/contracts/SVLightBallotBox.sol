pragma solidity ^0.4.19;

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

    // test mode - operations like changing start/end times
    bool public testMode = false;

    // struct for ballot
    struct Ballot {
        bytes32 ballotData;
        address sender;
        // we use a uint32 here because addresses are 20 bytes and this might help
        // solidity pack the block number well. gives us a little room to expand too if needed.
        uint32 blockN;
    }

    // Maps to store ballots, along with corresponding log of voters.
    // Should only be modified through `addBallotAndVoter` internal function
    mapping (uint256 => Ballot) public ballotMap;
    mapping (uint256 => bytes32) public associatedPubkeys;
    uint256 public nVotesCast = 0;

    // Use a map for voters to look up their ballot
    mapping (address => uint256) public voterToBallotID;

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
    bool public useEncryption;

    // deprecation flag - doesn't actually do anything besides signal that this contract is deprecated;
    bool public deprecated = false;

    //// ** Events
    event CreatedBallot(address _creator, uint64[2] _openPeriod, bool _useEncryption, bytes32 _specHash);
    event SuccessfulPkVote(address voter, bytes32 ballot, bytes32 pubkey);
    event SuccessfulVote(address voter, bytes32 ballot);
    event SeckeyRevealed(bytes32 secretKey);
    event TestingEnabled();
    event DeprecatedContract();
    event SetOwner(address _owner);


    //// ** Modifiers

    modifier ballotOpen() {
        if(doRequire(uint64(block.timestamp) >= startTime && uint64(block.timestamp) < endTime, ERR_BALLOT_CLOSED))
            _;
    }

    modifier onlyTesting() {
        if(doRequire(testMode, ERR_TESTING_REQ))
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

    //// ** Functions

    uint16 constant F_USE_ENC = 0;
    uint16 constant F_TESTING = 1;
    // Constructor function - init core params on deploy
    // timestampts are uint64s to give us plenty of room for millennia
    // flags are [_useEncryption, enableTesting]
    function SVLightBallotBox(bytes32 _specHash, uint64[2] openPeriod, bool[2] flags) public {

        if (flags[F_TESTING]) {
            testMode = true;
            emit TestingEnabled();
        }

        useEncryption = flags[F_USE_ENC];
        specHash = _specHash;
        creationBlock = uint64(block.number);
        // add a rough prediction of what block is the starting block
        startingBlockAround = uint64((startTime - block.timestamp) / 15 + block.number);

        // take the max of the start time provided and the blocks timestamp to avoid a DoS against recent token holders
        // (which someone might be able to do if they could set the timestamp in the past)
        startTime = flags[F_TESTING] ? openPeriod[0] : max(openPeriod[0], uint64(block.timestamp));
        endTime = openPeriod[1];

        emit CreatedBallot(msg.sender, [startTime, endTime], useEncryption, specHash);
    }

    // Ballot submission
    function submitBallotWithPk(bytes32 encryptedBallot, bytes32 senderPubkey) req(useEncryption == true, ERR_ENC_DISABLED) ballotOpen() public {
        addBallotAndVoterWithPk(encryptedBallot, senderPubkey);
        emit SuccessfulPkVote(msg.sender, encryptedBallot, senderPubkey);
    }

    function submitBallotNoPk(bytes32 ballot) req(useEncryption == false, ERR_NO_ENC_DISABLED) ballotOpen public {
        addBallotAndVoterNoPk(ballot);
        emit SuccessfulVote(msg.sender, ballot);
    }

    // Internal function to ensure atomicity of voter log
    function addBallotAndVoterWithPk(bytes32 encryptedBallot, bytes32 senderPubkey) internal {
        uint256 ballotNumber = addBallotAndVoterNoPk(encryptedBallot);
        associatedPubkeys[ballotNumber] = senderPubkey;
    }

    function addBallotAndVoterNoPk(bytes32 encryptedBallot) internal returns (uint256) {
        uint256 ballotNumber = nVotesCast;
        ballotMap[ballotNumber] = Ballot(encryptedBallot, msg.sender, uint32(block.number));
        voterToBallotID[msg.sender] = ballotNumber;
        nVotesCast += 1;
        return ballotNumber;
    }

    // Allow the owner to reveal the secret key after ballot conclusion
    function revealSeckey(bytes32 _secKey) isOwner() req(block.timestamp > endTime, ERR_EARLY_SECKEY) public {
        ballotEncryptionSeckey = _secKey;
        seckeyRevealed = true; // this flag allows the contract to be locked
        emit SeckeyRevealed(_secKey);
    }

    function getEncSeckey() public constant returns (bytes32) {
        return ballotEncryptionSeckey;
    }

    // Test functions
    function setEndTime(uint64 newEndTime) onlyTesting() isOwner() public {
        endTime = newEndTime;
    }

    function setDeprecated() isOwner() public {
        deprecated = true;
        emit DeprecatedContract();
    }

    function setOwner(address newOwner) isOwner() public {
        owner = newOwner;
        emit SetOwner(newOwner);
    }

    // utils
    function max(uint64 a, uint64 b) pure internal returns(uint64) {
        if (a > b) {
            return a;
        }
        return b;
    }
}
