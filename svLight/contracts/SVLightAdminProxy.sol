pragma solidity ^0.4.22;

// Admin Proxy SC for SVDemocIndex v1.0
// (c) SecureVote 2018
// Author: Max Kaye <max@secure.vote>
// Released under MIT licence

import { descriptiveErrors, claimReverseENS, copyMemAddrArray, upgradePtr } from "./SVCommon.sol";
import "./IndexInterface.sol";


contract SVLightAdminProxy is descriptiveErrors, claimReverseENS, copyMemAddrArray {
    bool public isProxyContract = true;
    uint public proxyVersion = 2;

    // storage variables
    bytes32 public democHash;
    mapping (address => bool) public admins;
    upgradePtr public forwardTo;
    address[] adminLog;

    bool callActive = false;
    address caller = address(0);

    event AddedAdminToPx(address newAdmin);
    event RemovedAdmin(address oldAdmin);
    event FailedToFwdCall(uint value, bytes data);

    modifier isAdmin() {
        if(doRequire(admins[msg.sender], ERR_PX_FORBIDDEN)) {
            _;
        }
    }


    constructor(bytes32 _democHash, address initAdmin, address _fwdTo) public {
        // this will mostly be called by SVLightIndex so we shouldn't use msg.sender.
        democHash = _democHash;
        _addNewAdmin(initAdmin);
        initReverseENS(msg.sender);  // this is the SVLightIndex
        forwardTo = upgradePtr(_fwdTo);
    }


    // fallback function - forwards all value and data to the `forwardTo` address.
    function() public payable {
        if (callActive) {
            // allows refunds to addresses
            caller.transfer(msg.value);
        } else {
            callActive = true;
            caller = msg.sender;

            // need to check if the SVIndex at forwardTo has been upgraded...
            address _ptr = forwardTo.getUpgradePointer();
            if (_ptr != address(0)) {
                forwardTo = upgradePtr(_ptr);
            }

            if (msg.data.length > 0) {
                require(admins[msg.sender], "must be admin to fwd data");
                // note: for this to work we need the `forwardTo` contract must recognise _this_ contract
                // (not _our_ msg.sender) as having the appropriate permissions (for whatever it is we're calling)
                require(address(forwardTo).call.value(msg.value)(msg.data));
                callActive = false;
            } else {
                // allow fwding just money to the democracy
                IxIface ix = IxIface(forwardTo);
                ix.payForDemocracy.value(msg.value)(democHash);
            }
        }
    }

    function fwdData(address toAddr, bytes data) isAdmin() public {
        if(!toAddr.call(data)){
            emit FailedToFwdCall(0, data);
        }
    }

    function fwdPayment(address toAddr) isAdmin() public payable {
        if(!toAddr.send(msg.value)){
            emit FailedToFwdCall(msg.value, new bytes(0));
        }
    }

    function fwdPaymentAndData(address toAddr, bytes data) isAdmin() public payable {
        if(!toAddr.call.value(msg.value)(data)){
            emit FailedToFwdCall(msg.value, data);
        }
    }

    // community stuff

    function deployCommunityBallot() external payable {
        IxIface ix = IxIface(forwardTo);
        require(ix.communityEnabled(democHash), "community ballots disabled");

    }

    // admin management

    // add an admin
    function addNewAdmin(address newAdmin) isAdmin() public {
        _addNewAdmin(newAdmin);
    }

    function _addNewAdmin(address newAdmin) internal {
        admins[newAdmin] = true;
        adminLog.push(newAdmin);
        emit AddedAdminToPx(newAdmin);
    }

    function removeAdmin(address oldAdmin) isAdmin() req(msg.sender != oldAdmin, ERR_CANNOT_REMOVE_SELF) public {
        admins[oldAdmin] = false;
        emit RemovedAdmin(oldAdmin);
    }

    // simple function to list all admins
    function listAllAdmins() public constant returns (address[]) {
        // start a dynamic memory array (note: will be replaced)
        address[] memory allAdmins;

        // main loop - check all admins in adminLog
        for(uint i = 0; i < adminLog.length; i++) {
            address nextPossibleAdmin = adminLog[i];
            if (admins[nextPossibleAdmin]) {
                // imported via `copyMemAddrArray` inheritence
                allAdmins = _appendMemArray(allAdmins, nextPossibleAdmin);
            }
        }
        return allAdmins;
    }

    // option for community stuff

}
