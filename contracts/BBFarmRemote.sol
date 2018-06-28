pragma solidity ^0.4.24;

/**
 * BBFarm is a contract to use BBLib to replicate the functionality of
 * SVLightBallotBox within a centralised container (like the Index).
 */

import "./BBLib.sol";
import { permissioned, payoutAllC } from "./SVCommon.sol";
import "./hasVersion.sol";
import { IxIface } from "./SVIndex.sol";
import "./BPackedUtils.sol";
import "./IxLib.sol";
import { BBFarmIface } from "./BBFarm.sol";


library CalcBallotId {
    function calc( bytes4 namespace
                 , bytes32 specHash
                 , uint256 packed
                 , address proposer
                 , bytes24 extraData
            ) internal pure returns (uint256 ballotId) {
        bytes32 midHash = keccak256(abi.encodePacked(specHash, packed, proposer, extraData));
        ballotId = (uint256(namespace) << 224) & uint256(midHash);
    }
}


/**
 * This contract is on mainnet - should not take votes but should
 * deterministically calculate ballotId
 */
contract BBFarmProxy is BBFarmIface {
    bytes4 namespace;
    bytes32 foreignNetworkId;
    uint constant VERSION = 3;
    uint nBallots = 0;

    constructor(bytes4 _namespace, bytes32 _foreignNetworkId) payoutAllC(msg.sender) public {
        namespace = _namespace;
        foreignNetworkId = _foreignNetworkId;
    }

    function initBallot( bytes32 specHash
                       , uint256 packed
                       , IxIface ix
                       , address bbAdmin
                       , bytes24 extraData
                ) only_editors() external returns (uint ballotId) {
        // calculate the ballotId based on the last 224 bits of the specHash.
        ballotId = ballotId = CalcBallotId.calc(namespace, specHash, packed, bbAdmin, extraData);
        // we need to call the init functions on our libraries
        // getDb(ballotId).init(specHash, packed, ix, bbAdmin, bytes16(uint128(extraData)));
        nBallots += 1;

        emit BallotCreatedWithID(ballotId);
        emit BallotOnForeignNetwork(foreignNetworkId, ballotId);
    }
}


/**
 * This BBFarm lives on classic (or wherever) and does take votes
 * (often / always by proxy) and calculates the same ballotId as
 * above.
 */
contract BBFarmRemote is BBFarmIface {
    using BBLib for BBLib.DB;
    using IxLib for IxIface;

    // namespaces should be unique for each bbFarm
    bytes4 namespace;
    IxIface index;

    uint constant VERSION = 3;

    mapping (uint224 => BBLib.DB) dbs;
    uint nBallots = 0;

    /* modifiers */

    modifier req_namespace(uint ballotId) {
        // bytes4() will take the _first_ 4 bytes
        require(bytes4(ballotId >> 224) == namespace, "bad-namespace");
        _;
    }

    /* Constructor */

    constructor(bytes4 _namespace, IxIface ix) payoutAllC(msg.sender) public {
        assert(BBLib.getVersion() == 6);
        namespace = _namespace;
        index = ix;
        emit BBFarmInit(_namespace);
    }

    /* base SCs */

    function _getPayTo() internal view returns (address) {
        return owner;
    }

    function getVersion() external pure returns (uint) {
        return VERSION;
    }

    /* global funcs */

    function getNamespace() external view returns (bytes4) {
        return namespace;
    }

    function getBBLibVersion() external view returns (uint256) {
        return BBLib.getVersion();
    }

    function getNBallots() external view returns (uint256) {
        return nBallots;
    }

    /* db lookup helper */

    function getDb(uint ballotId) internal view returns (BBLib.DB storage) {
        // cut off anything above 224 bits (where the namespace goes)
        return dbs[uint224(ballotId)];
    }

    /* Init ballot */

    function initBallot( bytes32 specHash
                       , uint256 packed
                       , IxIface ix
                       , address bbAdmin
                       , bytes24 extraData
                ) only_editors() external returns (uint ballotId) {
        // we cannot call initBallot on a BBFarmRemote (since it should only be called by editors)
        revert();
    }

    function initBallotProxy(uint8 v, bytes32 r, bytes32 s, bytes32[4] params) external returns (uint256 ballotId) {
        // params is a bytes32[4] of [specHash, packed, proposer, extraData]
        bytes32 specHash = params[0];
        uint256 packed = uint256(params[1]);
        address proposer = address(params[2]);
        bytes24 extraData = bytes24(params[3]);

        bytes memory signed = abi.encodePacked(specHash, packed, proposer, extraData);
        bytes32 msgHash = keccak256(signed);

        address proposerRecovered = ecrecover(msgHash, v, r, s);
        require(proposerRecovered == proposer, "bad-proposer");

        ballotId = CalcBallotId.calc(namespace, specHash, packed, proposer, extraData);
        getDb(ballotId).init(specHash, packed, index, proposer, bytes16(uint128(extraData)));
        nBallots += 1;

        emit BallotCreatedWithID(ballotId);
    }

    /* Sponsorship */

    function sponsor(uint ballotId) external payable {
        BBLib.DB storage db = getDb(ballotId);
        db.logSponsorship(msg.value);
        doSafeSend(db.index.getPayTo(), msg.value);
        emit Sponsorship(ballotId, msg.value);
    }

    /* Voting */

    function submitVote(uint ballotId, bytes32 vote, bytes extra) req_namespace(ballotId) external {
        getDb(ballotId).submitVote(vote, extra);
        emit Vote(ballotId, vote, msg.sender, extra);
    }

    function submitProxyVote(bytes32[5] proxyReq, bytes extra) req_namespace(uint256(proxyReq[3])) external {
        // see https://github.com/secure-vote/tokenvote/blob/master/Docs/DataStructs.md for breakdown of params
        // pr[3] is the ballotId, and pr[4] is the vote
        uint ballotId = uint256(proxyReq[3]);
        address voter = getDb(ballotId).submitProxyVote(proxyReq, extra);
        bytes32 vote = proxyReq[4];
        emit Vote(ballotId, vote, voter, extra);
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
            , bytes16 extraData) {
        BBLib.DB storage db = getDb(ballotId);
        uint packed = db.packed;
        return (
            db.getSequenceNumber(voter) > 0,
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
        (voteData, sender, extra, ) = getDb(ballotId).getVote(voteId);
    }

    function getSequenceNumber(uint ballotId, address voter) external view returns (uint32 sequence) {
        return getDb(ballotId).getSequenceNumber(voter);
    }

    function getTotalSponsorship(uint ballotId) external view returns (uint) {
        return getDb(ballotId).getTotalSponsorship();
    }

    function getSponsorsN(uint ballotId) external view returns (uint) {
        return getDb(ballotId).sponsors.length;
    }

    function getSponsor(uint ballotId, uint sponsorN) external view returns (address sender, uint amount) {
        return getDb(ballotId).getSponsor(sponsorN);
    }

    function getCreationTs(uint ballotId) external view returns (uint) {
        return getDb(ballotId).creationTs;
    }

    /* ADMIN */

    // Allow the owner to reveal the secret key after ballot conclusion
    function revealSeckey(uint ballotId, bytes32 sk) external {
        BBLib.DB storage db = getDb(ballotId);
        db.requireBallotOwner();
        db.requireBallotClosed();
        db.revealSeckey(sk);
    }

    // note: testing only.
    function setEndTime(uint ballotId, uint64 newEndTime) external {
        BBLib.DB storage db = getDb(ballotId);
        db.requireBallotOwner();
        db.requireTesting();
        db.setEndTime(newEndTime);
    }

    function setDeprecated(uint ballotId) external {
        BBLib.DB storage db = getDb(ballotId);
        db.requireBallotOwner();
        db.deprecated = true;
    }

    function setBallotOwner(uint ballotId, address newOwner) external {
        BBLib.DB storage db = getDb(ballotId);
        db.requireBallotOwner();
        db.ballotOwner = newOwner;
    }
}
