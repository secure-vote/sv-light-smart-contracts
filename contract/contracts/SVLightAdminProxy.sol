pragma solidity ^0.4.21;

// Admin Proxy SC for SVDemocIndex v1.0
// (c) SecureVote 2018
// Author: Max Kaye <max@secure.vote>
// Released under MIT licence

import { descriptiveErrors, claimReverseENS, copyMemAddrArray } from "./SVCommon.sol";

contract SVLightAdminProxy is descriptiveErrors, claimReverseENS, copyMemAddrArray {

    // storage variables
    mapping (address => bool) public admins;
    address public forwardTo;
    address[] adminLog;

    bool callActive = false;
    address caller = address(0);

    event AddedAdminToPx(address newAdmin);
    event FailedToFwdCall(uint value, bytes data);

    modifier isAdmin() {
        if(doRequire(admins[msg.sender], ERR_PX_FORBIDDEN)) {
            _;
        }
    }

    // we want to be able to handle refunds - this modifier allows the call if 
    // we're either an admin or a call is active
    modifier adminOrInCall() {
        if(doRequire(admins[msg.sender] || callActive, ERR_PX_FORBIDDEN))
            _;
    }


    function SVLightAdminProxy(address initAdmin, address _fwdTo) public {
        // this will mostly be called by SVLightIndex so we shouldn't use msg.sender.
        _addNewAdmin(initAdmin);
        initReverseENS(initAdmin);
        forwardTo = _fwdTo;
    }

    // fallback function - forwards all value and data to the `forwardTo` address.
    function() adminOrInCall() public payable {
        if (callActive) {
            doRequire(caller.send(msg.value), ERR_PX_ETH_TFER_FAILED);
        } else {
            callActive = true;
            caller = msg.sender;
            // note: for this to work we need the `forwardTo` contract must recognise _this_ contract
            // (not _our_ msg.sender) as having the appropriate permissions (for whatever it is we're calling)
            if(!doRequire(forwardTo.call.value(msg.value)(msg.data), ERR_CALL_FWD_FAILED)){
                emit FailedToFwdCall(msg.value, msg.data);
            }
            callActive = false;
        }
    }

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
}
