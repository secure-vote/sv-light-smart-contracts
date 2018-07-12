pragma solidity 0.4.24;

contract UnsafeEd25519SelfDelegation {
    
    event DelegationCreated(bytes32 dlgtRequest, bytes32 pubKey, bytes32[2] signature);
    
    struct Delegation {
        bytes32 dlgtRequest;
        bytes32 sig1;
        bytes32 sig2;
        uint recordedTs;
    }
   
    // Maps a public key to delegation
    mapping (bytes32 => Delegation[]) public delegations;
    bytes32[] public delegationsLog;
    
    // Log addresses ppl are delegating _to_
    mapping (address => bool) seenAddress;
    address[] public addressLog;
    
    // Log delegation requests we haven't seen before
    mapping (bytes32 => bool) dlgtReqsSeen;
    
    // Constructor
    constructor() public {}
    
    // Adding a delegation - the single write operation in this contract
    function addUntrustedSelfDelegation(bytes32 dlgtRequest, bytes32 pubKey, bytes32[2] signature) external {
        // note: dlgtRequest is split into 9, 3, and 20 bytes; the former is a unique tag to ensure signatures from 
        // ED25519 keys can't be reused for transactions or other networks, the 3 bytes are used as a nonce, and
        // the final 20 bytes is the ethereum address we're delegating too.
        
        // take first 9 bytes of dlgtRequest
        require(bytes9(dlgtRequest) == bytes9(0x53562d45442d455448), "dlgtReq header != SV-ED-ETH");
        
        // // make sure we haven't seen this delegation request before with this pubkey and sig
        bytes32 dlgtReqAllHash = keccak256(abi.encodePacked(dlgtRequest, pubKey, signature[0], signature[1]));
        require(dlgtReqsSeen[dlgtReqAllHash] == false, 'replay');
        dlgtReqsSeen[dlgtReqAllHash] = true;
        
        // // take last 20 bytes and convert to address 
        address dlgtTo = address(uint160(dlgtRequest));
        
        delegations[pubKey].push(Delegation(dlgtRequest, signature[0], signature[1], now));
        emit DelegationCreated(dlgtRequest, pubKey, signature);
        
        bool addToLog = delegations[pubKey][0].recordedTs == 0;
        if (addToLog) 
            delegationsLog.push(pubKey);
            
        if (!seenAddress[dlgtTo]) {
            seenAddress[dlgtTo] = true;
            addressLog.push(dlgtTo);
        }
    }
    
    // Simple getters 
    function dLogN() external view returns (uint) {
        return delegationsLog.length;
    }
    
    function nDelegations(bytes32 pubKey) external view returns (uint) {
        return delegations[pubKey].length;
    }
    
    // Complex Getters 

    // Get all delegations recorded for a particular public key
    function getAllForPubKey(bytes32 pubKey) external view returns (bytes32[] memory dlgtRequests, bytes32[] memory sigs1, bytes32[] memory sigs2, uint[] recordedTs) {
        return getAllForPubKeyBetween(pubKey, 0, 2**64-1);
    }
    
    // Get all recorded delegations between a start date and end date
    function getAllForPubKeyBetween (bytes32 pubKey, uint startDate, uint endDate) public view returns (bytes32[] memory dlgtRequests, bytes32[] memory sig1s, bytes32[] memory sig2s, uint[] recordedTimeStamps) {
        for (uint i = 0; i < delegations[pubKey].length; i++) {
            if (delegations[pubKey][i].recordedTs > startDate && delegations[pubKey][i].recordedTs < endDate) {
                dlgtRequests = appendBytes32(dlgtRequests, delegations[pubKey][i].dlgtRequest);
                sig1s = appendBytes32(sig1s, delegations[pubKey][i].sig1);
                sig2s = appendBytes32(sig2s, delegations[pubKey][i].sig2);
                recordedTimeStamps = appendUint(recordedTimeStamps, delegations[pubKey][i].recordedTs);
            }
        }        
    }
    
    // Helper functions
    function appendUint (uint[] memory arr, uint val) internal pure returns (uint[] memory toRet) {
        toRet = new uint[](arr.length + 1);

        for (uint256 i = 0; i < arr.length; i++) {
            toRet[i] = arr[i];
        }

        toRet[arr.length] = val;
    }
    
    function appendBytes32(bytes32[] memory arr, bytes32 val) internal pure returns (bytes32[] memory toRet) {
        toRet = new bytes32[](arr.length + 1);

        for (uint256 i = 0; i < arr.length; i++) {
            toRet[i] = arr[i];
        }

        toRet[arr.length] = val;
    }
    
}