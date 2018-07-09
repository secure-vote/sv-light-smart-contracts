pragma solidity ^0.4.24;

/**
 * BBFarm is a contract to use BBLib to replicate the functionality of
 * SVLightBallotBox within a centralised container (like the Index).
 */

import "./BBLib.v7.sol";
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
        ballotId = (uint256(namespace) << 224) | uint256(uint224(midHash));
    }
}


/**
 * This contract is on mainnet - should not take votes but should
 * deterministically calculate ballotId
 */
contract RemoteBBFarmProxy is BBFarmIface {
    bytes4 namespace;
    bytes32 foreignNetworkDetails;
    uint constant VERSION = 3;

    /* storing info about ballots */

    struct BallotPx {
        bytes32 specHash;
        uint256 packed;
        IxIface index;
        address bbAdmin;
        bytes16 extraData;
        uint creationTs;
    }

    BallotPx[] ballots;
    mapping(uint => uint) ballotIdToN;

    /* constructor */

    constructor(bytes4 _namespace, uint32 fChainId, uint32 fNetworkId, address fBBFarm) payoutAllC(msg.sender) public {
        namespace = _namespace;
        // foreignNetworkDetails has the following format:
        //   [uint32 - unallocated]
        //   [uint32 - chain id; 0 for curr chainId]
        //   [uint32 - network id; 0 for curr network]
        //   [uint160 - address of bbFarm on target network]
        // eth mainnet is: [0][1][1][<addr>]
        // eth classic is: [0][61][1][<addr>]
        // ropsten is: [0][3][3][<addr>]  -- TODO confirm
        // kovan is: [0][42][42][<addr>]  -- TODO confirm
        // morden is: [0][62][2][<addr>] -- https://github.com/ethereumproject/go-ethereum/blob/74ab56ba00b27779b2bdbd1c3aef24bdeb941cd8/core/config/morden.json
        // rinkeby is: [0][4][4][<addr>] -- todo confirm
        foreignNetworkDetails = bytes32(uint(fChainId) << 192 | uint(fNetworkId) << 160 | uint(fBBFarm));
    }

    /* global getters */

    function getNamespace() external view returns (bytes4) {
        return namespace;
    }

    function getBBLibVersion() external view returns (uint256) {
        return BBLib.getVersion();
    }

    function getNBallots() external view returns (uint256) {
        return ballots.length;
    }

    function getVersion() external pure returns (uint256) {
        return VERSION;
    }

    /* foreign integration */

    function getVotingNetworkDetails() external view returns (bytes32) {
        // this is given during construction; format is:
        // [32b unallocated][32b chainId][32b networkId][160b bbFarm addr on foreign network]
        return foreignNetworkDetails;
    }

    /* init of ballots */

    function initBallot( bytes32 specHash
                       , uint256 packed
                       , IxIface ix
                       , address bbAdmin
                       , bytes24 extraData
                ) only_editors() external returns (uint ballotId) {
        // calculate the ballotId based on the last 224 bits of the specHash.
        ballotId = ballotId = CalcBallotId.calc(namespace, specHash, packed, bbAdmin, extraData);
        // we just store a log of the ballot here; no additional logic
        ballotIdToN[ballotId] = ballots.length;
        ballots.push(BallotPx(specHash, packed, ix, bbAdmin, bytes16(uint128(extraData)), now));

        emit BallotCreatedWithID(ballotId);
        emit BallotOnForeignNetwork(foreignNetworkDetails, ballotId);
    }

    function initBallotProxy(uint8, bytes32, bytes32, bytes32[4]) external returns (uint256) {
        // we don't support initBallotProxy on mainnet
        revert();
    }

    /* Sponsorship */

    function sponsor(uint) external payable {
        // no sponsorship support for remote ballots
        revert();
    }

    /* Voting */

    function submitVote(uint, bytes32, bytes) /*req_namespace(ballotId)*/ external {
        revert();  // no voting support for px
    }

    function submitProxyVote(bytes32[5], bytes) /*req_namespace(uint256(proxyReq[3]))*/ external {
        revert();  // no voting support for px
    }

    /* Getters */

    function getDetails(uint ballotId, address) external view returns
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
        uint n = ballotIdToN[ballotId];
        uint packed = ballots[n].packed;
        return (
            false,
            uint(0)-1,
            bytes32(0),
            BPackedUtils.packedToSubmissionBits(packed),
            BPackedUtils.packedToStartTime(packed),
            BPackedUtils.packedToEndTime(packed),
            ballots[n].specHash,
            false,
            ballots[n].bbAdmin,
            ballots[n].extraData
        );
    }


    function getVote(uint, uint) external view returns (bytes32, address, bytes) {
        revert();
    }

    function getVoteAndTime(uint, uint) external view returns (bytes32, address, bytes, uint) {
        revert();
    }

    function getSequenceNumber(uint, address) external pure returns (uint32) {
        revert();
    }

    function getTotalSponsorship(uint) external view returns (uint) {
        revert();
    }

    function getSponsorsN(uint) external view returns (uint) {
        revert();
    }

    function getSponsor(uint, uint) external view returns (address, uint) {
        revert();
    }

    function getCreationTs(uint ballotId) external view returns (uint) {
        return ballots[ballotIdToN[ballotId]].creationTs;
    }

    /* ADMIN */

    // Allow the owner to reveal the secret key after ballot conclusion
    function revealSeckey(uint, bytes32) external {
        revert();
    }

    // note: testing only.
    function setEndTime(uint, uint64) external {
        revert();
    }

    function setDeprecated(uint) external {
        revert();
    }

    function setBallotOwner(uint, address) external {
        revert();
    }
}


/**
 * This BBFarm lives on classic (or wherever) and does take votes
 * (often / always by proxy) and calculates the same ballotId as
 * above.
 */
contract RemoteBBFarm is BBFarmIface {
    using BBLibV7 for BBLibV7.DB;

    // namespaces should be unique for each bbFarm
    bytes4 namespace;

    uint constant VERSION = 3;

    mapping (uint224 => BBLibV7.DB) dbs;
    uint nBallots = 0;

    /* modifiers */

    modifier req_namespace(uint ballotId) {
        // bytes4() will take the _first_ 4 bytes
        require(bytes4(ballotId >> 224) == namespace, "bad-namespace");
        _;
    }

    /* Constructor */

    constructor(bytes4 _namespace) payoutAllC(msg.sender) public {
        assert(BBLib.getVersion() == 7);
        namespace = _namespace;
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

    function getVotingNetworkDetails() external view returns (bytes32) {
        return bytes32(uint(this));
    }

    /* db lookup helper */

    function getDb(uint ballotId) internal view returns (BBLibV7.DB storage) {
        // cut off anything above 224 bits (where the namespace goes)
        return dbs[uint224(ballotId)];
    }

    /* Init ballot */

    function initBallot( bytes32
                       , uint256
                       , IxIface
                       , address
                       , bytes24
                ) only_editors() external returns (uint) {
        // we cannot call initBallot on a BBFarmRemote (since it should only be called by editors)
        revert();
    }

    /*uint8 v, bytes32 r, bytes32 s, bytes32[4] params*/
    function initBallotProxy(uint8, bytes32, bytes32, bytes32[4]) external returns (uint256 /*ballotId*/) {
        // do not allow proxy ballots either atm
        revert();
        // // params is a bytes32[4] of [specHash, packed, proposer, extraData]
        // bytes32 specHash = params[0];
        // uint256 packed = uint256(params[1]);
        // address proposer = address(params[2]);
        // bytes24 extraData = bytes24(params[3]);

        // bytes memory signed = abi.encodePacked(specHash, packed, proposer, extraData);
        // bytes32 msgHash = keccak256(signed);

        // address proposerRecovered = ecrecover(msgHash, v, r, s);
        // require(proposerRecovered == proposer, "bad-proposer");

        // ballotId = CalcBallotId.calc(namespace, specHash, packed, proposer, extraData);
        // getDb(ballotId).init(specHash, packed, IxIface(0), proposer, bytes16(uint128(extraData)));
        // nBallots += 1;

        // emit BallotCreatedWithID(ballotId);
    }

    /* Sponsorship */

    function sponsor(uint) external payable {
        // no sponsorship on foreign networks
        revert();
    }

    /* Voting */

    function submitVote(uint ballotId, bytes32 vote, bytes extra) req_namespace(ballotId) external {
        getDb(ballotId).submitVoteAlways(vote, extra);
        emit Vote(ballotId, vote, msg.sender, extra);
    }

    function submitProxyVote(bytes32[5] proxyReq, bytes extra) req_namespace(uint256(proxyReq[3])) external {
        // see https://github.com/secure-vote/tokenvote/blob/master/Docs/DataStructs.md for breakdown of params
        // pr[3] is the ballotId, and pr[4] is the vote
        uint ballotId = uint256(proxyReq[3]);
        address voter = getDb(ballotId).submitProxyVoteAlways(proxyReq, extra);
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
        BBLibV7.DB storage db = getDb(ballotId);
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

    function getVote(uint, uint) external view returns (bytes32, address, bytes) {
        // don't let users use getVote since it's unsafe without taking the casting time into account
        revert();
    }

    function getVoteAndTime(uint ballotId, uint voteId) external view returns (bytes32 voteData, address sender, bytes extra, uint castTs) {
        return getDb(ballotId).getVote(voteId);
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
        BBLibV7.DB storage db = getDb(ballotId);
        db.requireBallotOwner();
        db.requireBallotClosed();
        db.revealSeckey(sk);
    }

    // note: testing only.
    function setEndTime(uint ballotId, uint64 newEndTime) external {
        BBLibV7.DB storage db = getDb(ballotId);
        db.requireBallotOwner();
        db.requireTesting();
        db.setEndTime(newEndTime);
    }

    function setDeprecated(uint ballotId) external {
        BBLibV7.DB storage db = getDb(ballotId);
        db.requireBallotOwner();
        db.deprecated = true;
    }

    function setBallotOwner(uint ballotId, address newOwner) external {
        BBLibV7.DB storage db = getDb(ballotId);
        db.requireBallotOwner();
        db.ballotOwner = newOwner;
    }
}
