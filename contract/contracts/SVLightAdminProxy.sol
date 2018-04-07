pragma solidity ^0.4.21;

// Admin Proxy SC for SVDemocIndex v1.0
// (c) SecureVote 2018
// Author: Max Kaye <max@secure.vote>
// Released under MIT licence

import "./SVCommon.sol";

contract SVLightAdminProxy is descriptiveErrors, claimReverseENS, copyMemAddrArray {

    // storage variables
    mapping (address => bool) public admins;
    address public forwardTo;
    address[] adminLog;


    modifier isAdmin() {
        doRequire(admins[msg.sender], "msg.sender does not have admin permissions");
        _;
    }


    function SVLightAdminProxy(address initAdmin, address _fwdTo) public {
        // this will mostly be called by SVLightIndex so we shouldn't use msg.sender.
        addNewAdmin(initAdmin);
        initReverseENS(initAdmin);
        forwardTo = _fwdTo;
    }

    // fallback function - forwards all value and data to the `forwardTo` address.
    function() isAdmin() public payable {
        // note: for this to work we need the `forwardTo` contract must recognise _this_ contract
        // (not msg.sender) as having the appropriate permissions (for whatever it is we're calling)
        doRequire(forwardTo.call.value(msg.value)(msg.data), "call forwarded but tx failed - permissions okay");
    }

    // add an admin
    function addNewAdmin(address newAdmin) isAdmin() public {
        admins[newAdmin] = true;
        adminLog.push(newAdmin);
    }

    function removeAdmin(address oldAdmin) isAdmin() public {
        doRequire(msg.sender != oldAdmin, "cannot remove yourself as admin");
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
