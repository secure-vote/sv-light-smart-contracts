pragma solidity ^0.4.21;

// DELEGATION SC v1.2
// (c) SecureVote 2018
// Author: Max Kaye <max@secure.vote>
// Released under MIT licence

// the most up-to-date version of the contract lives at delegate.secvote.eth


import "./SVCommon.sol";
import "./SVDelegationV0101.sol";


// Main delegation contract v1.2
contract SVDelegationV0102 is owned, upgradable, copyMemAddrArray {

    // in the last version we didn't include enough data - this makes it trivial to traverse off-chain
    struct Delegation {
        uint64 thisDelegationId;
        uint64 prevDelegationId;
        uint64 setAtBlock;
        address delegatee;
        address delegator;
        address tokenContract;
    }

    // easy lookups
    mapping (address => mapping (address => Delegation)) tokenDlgts;
    mapping (address => Delegation) globalDlgts;

    // track which token contracts we know about for easy traversal + backwards compatibility
    mapping (address => bool) knownTokenContracts;
    address[] logTokenContracts;

    // track all delegations via an indexed map
    mapping (uint64 => Delegation) historicalDelegations;
    uint64 public totalDelegations = 0;

    // reference to v1.0 of contract
    SVDelegationV0101 prevSVDelegation;

    // pretty straight forward - events
    event SetGlobalDelegation(address voter, address delegate);
    event SetTokenDelegation(address voter, address tokenContract, address delegate);

    // main constructor - requires the prevDelegationSC address
    function SVDelegationV0102(address prevDelegationSC) public {
        // TODO: pretend we're this current contract? (i.e. v0102)  - if we need different method signatures we could write an interface, keeps file small / compilation fast
        prevSVDelegation = SVDelegationV0101(prevDelegationSC);

        // commit the genesis historical delegation to history (like genesis block) - somewhere to point back to
        createDelegation(address(0), 0, address(0));
        // todo: should we bootstrap from previous delegation SC - i.e. not start from 0 - sort of makes "prevDelegation" irrelevent
    }

    // internal function to handle inserting delegates into state
    function createDelegation(address dlgtAddress, uint64 prevDelegationId, address tokenContract) internal returns(Delegation) {
        // use this to log known tokenContracts
        if (!knownTokenContracts[tokenContract]) {
            logTokenContracts.push(tokenContract);
            knownTokenContracts[tokenContract] = true;
        }

        uint64 myDelegationId = totalDelegations;
        historicalDelegations[myDelegationId] = Delegation(myDelegationId, prevDelegationId, uint64(block.number), dlgtAddress, msg.sender, tokenContract);
        totalDelegations += 1;

        return historicalDelegations[myDelegationId];
    }

    // get previous delegation, create new delegation via function and then commit to globalDlgts
    function setGlobalDelegation(address dlgtAddress) public {
        uint64 prevDelegationId = globalDlgts[msg.sender].thisDelegationId;
        globalDlgts[msg.sender] = createDelegation(dlgtAddress, prevDelegationId, address(0));
        emit SetGlobalDelegation(msg.sender, dlgtAddress);
    }

    // get previous delegation, create new delegation via function and then commit to tokenDlgts
    function setTokenDelegation(address tokenContract, address dlgtAddress) public {
        uint64 prevDelegationId = tokenDlgts[tokenContract][msg.sender].thisDelegationId;
        tokenDlgts[tokenContract][msg.sender] = createDelegation(dlgtAddress, prevDelegationId, tokenContract);
        emit SetTokenDelegation(msg.sender, tokenContract, dlgtAddress);
    }

    // given some voter and token address, get the delegation id - failover to global on 0 address
    function getDelegationID(address voter, address tokenContract) public constant returns(uint64) {
        // default to token resolution but use global if no delegation
        Delegation memory _tokenDlgt = tokenDlgts[tokenContract][voter];
        if (tokenContract == address(0)) {
            _tokenDlgt = globalDlgts[voter];
        }

        // default to 0 if we don't have a valid delegation
        if (_validDelegation(_tokenDlgt)) {
            return _tokenDlgt.thisDelegationId;
        }
        return 0;
    }

    function resolveDelegation(address voter, address tokenContract) public constant returns(uint64, uint64, uint64, address, address, address) {
        Delegation memory _tokenDlgt = tokenDlgts[tokenContract][voter];

        // if we have a delegation in this contract return it
        if (_validDelegation(_tokenDlgt)) {
            return _dlgtRet(_tokenDlgt);
        }

        // otherwise try the global delegation
        Delegation memory _globalDlgt = globalDlgts[voter];
        if (_validDelegation(_globalDlgt)) {
            return _dlgtRet(_globalDlgt);
        }

        // but if we don't have a delegation in this contract then resolve according the prev contract
        return prevSVDelegation.resolveDelegation(voter, tokenContract);
    }

    // returns 2 lists: first of voter addresses, second of token contracts
    function findPossibleDelegatorsOf(address delegate) public view returns(address[] memory, address[] memory) {
        // not meant to be run on-chain, but off-chain via API, mostly convenience
        address[] memory voters;
        address[] memory tokenContracts;
        Delegation memory _delegation;

        // first loop through delegations in this contract
        uint64 i;
        // start at 1 because the first delegation is a "genesis" delegation in constructor
        for (i = 1; i < totalDelegations; i++) {
            _delegation = historicalDelegations[i];
            if (_delegation.delegatee == delegate) {
                // since `.push` isn't available on memory arrays, use their length as the next index location
                voters = _appendMemArray(voters, _delegation.delegator);
                tokenContracts = _appendMemArray(tokenContracts, _delegation.tokenContract);
            }
        }

        // TODO: Call prevSVDelegation.findPossibleDelegatorsOf and append to results

        // // then loop through delegations in the previous contract
        // for (i = 0; i < oldSenders.length; i++) {
        //     uint256 _oldId;
        //     address _oldDlgt;
        //     uint256 _oldSetAtBlock;
        //     uint256 _oldPrevId;
        //     (_oldId, _oldDlgt, _oldSetAtBlock, _oldPrevId) = prevSVDelegation.resolveDelegation(oldSenders[i], oldToken);
        //     if (_oldDlgt == delegate && _oldSetAtBlock != 0) {
        //         voters = _appendMemArray(voters, oldSenders[i]);
        //         tokenContracts = _appendMemArray(tokenContracts, oldToken);
        //     }
        // }

        return (voters, tokenContracts);
    }

    // give access to historicalDelegations
    function getHistoricalDelegation(uint64 delegationId) public constant returns(uint64, uint64, uint64, address, address, address) {
        return _dlgtRet(historicalDelegations[delegationId]);
    }

    // access the globalDelegation map
    function _rawGetGlobalDelegation(address _voter) public constant returns(uint64, uint64, uint64, address, address, address) {
        return _dlgtRet(globalDlgts[_voter]);
    }

    // access the tokenDelegation map
    function _rawGetTokenDelegation(address _voter, address _tokenContract) public constant returns(uint64, uint64, uint64, address, address, address) {
        return _dlgtRet(tokenDlgts[_tokenContract][_voter]);
    }

    // access our log list of token contracts
    function _getLogTokenContract(uint256 i) public constant returns(address) {
        return logTokenContracts[i];
    }

    // convenience function to turn Delegations into a returnable structure
    function _dlgtRet(Delegation d) internal pure returns(uint64, uint64, uint64, address, address, address) {
        return (d.thisDelegationId, d.prevDelegationId, d.setAtBlock, d.delegatee, d.delegator, d.tokenContract);
    }

    // internal function to test if a delegation is valid or revoked / nonexistent
    function _validDelegation(Delegation d) internal pure returns(bool) {
        // probs simplest test to check if we have a valid delegation - important to check if delegation is set to 0x00
        // to avoid counting a revocation (which is done by delegating to 0x00)
        return d.setAtBlock > 0 && d.delegatee != address(0);
    }
}
