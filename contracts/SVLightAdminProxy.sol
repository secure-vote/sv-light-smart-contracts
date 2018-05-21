pragma solidity ^0.4.24;

// Admin Proxy SC for SVDemocIndex v1.0
// (c) SecureVote 2018
// Author: Max Kaye <max@secure.vote>
// Released under MIT licence

import { owned, upgradePtr } from "./SVCommon.sol";
import { IxIface } from "./IndexInterface.sol";
import { SVLightBallotBox } from "./SVLightBallotBox.sol";
import { BallotBoxIface } from "./BallotBoxIface.sol";
import { SVBallotConsts } from "./SVBallotConsts.sol";
import { MemArrApp } from "../libs/MemArrApp.sol";


contract SVLightAdminProxy is owned, SVBallotConsts {
    bool public isProxyContract = true;
    uint public proxyVersion = 2;

    bool public allowErc20OwnerClaim = true;

    // storage variables
    bytes32 public democHash;
    bool public communityBallotsEnabled = true;
    mapping (address => bool) public admins;
    upgradePtr public _forwardTo;
    address[] adminLog;

    bool callActive = false;
    address caller = address(0);

    bool safeTxMutex = false;

    event AddedAdminToPx(address newAdmin);
    event RemovedAdmin(address oldAdmin);
    event FailedToFwdCall(uint value, bytes data);

    modifier isAdmin() {
        require(admins[msg.sender], "isAdmin: forbidden");
        _;
    }


    constructor(bytes32 _democHash, address initAdmin, address _fwdTo) public {
        // this will mostly be called by SVLightIndex so we shouldn't use msg.sender.
        democHash = _democHash;
        _addAdmin(initAdmin);
        _forwardTo = upgradePtr(_fwdTo);
        owner = initAdmin;
    }


    // fallback function - forwards all value and data to the `forwardTo` address.
    function() public payable {
        if (callActive) {
            // allows refunds to addresses
            safeSend(caller, "", msg.value);
        } else {
            callActive = true;
            caller = msg.sender;

            address fwdTo = checkFwdAddressUpgrade();

            if (msg.data.length > 0) {
                require(admins[msg.sender], "fwd: must be admin");
                // note: for this to work we need the `forwardTo` contract must recognise _this_ contract
                // (not _our_ msg.sender) as having the appropriate permissions (for whatever it is we're calling)
                require(address(fwdTo).call.value(msg.value)(msg.data), "failed to fwd tx from admin");
            } else if (msg.value > 0) {
                // allow fwding just money to the democracy
                IxIface ix = IxIface(fwdTo);
                ix.payForDemocracy.value(msg.value)(democHash);
            }

            callActive = false;
        }
    }

    function checkFwdAddressUpgrade() internal returns (address) {
        // need to check if the SVIndex at forwardTo has been upgraded...
        address _ptr = _forwardTo.getUpgradePointer();
        if (_ptr != address(0)) {
            _forwardTo = upgradePtr(_ptr);
        }
        return _forwardTo;
    }

    function fwdData(address toAddr, bytes data) isAdmin() public {
        safeSend(toAddr, data, 0);
    }

    function fwdPayment(address toAddr) isAdmin() public payable {
        safeSend(toAddr, "", msg.value);
    }

    function fwdPaymentAndData(address toAddr, bytes data) isAdmin() public payable {
        safeSend(toAddr, data, msg.value);
    }

    function safeSend(address to, bytes data, uint val) internal {
        require(safeTxMutex == false, "reentrency lock active");
        safeTxMutex = true;
        require(to.call.value(val)(data), "send failed");
        safeTxMutex = false;
    }

    // community stuff

    function setCommunityBallotStatus(bool isEnabled) isAdmin() external {
        communityBallotsEnabled = isEnabled;
    }

    function getCommunityBallotsEnabled() external view returns (bool) {
        return communityBallotsEnabled;
    }

    // flag in submissionBits that indicates if it's official or not
    function deployCommunityBallot(bytes32 specHash, bytes32 extraData, uint256 packed) external payable returns (uint) {
        IxIface ix = IxIface(checkFwdAddressUpgrade());

        uint price = ix.getCommunityBallotWeiPrice();
        require(price <= msg.value, "community ballots require the correct fee");

        safeSend(ix.getPayTo(), "", price);
        safeSend(msg.sender, "", msg.value - price);

        // if accounts are not in good standing then we always allow community ballots
        bool canDoCommunityBallots = communityBallotsEnabled || !ix.accountInGoodStanding(democHash);
        require(canDoCommunityBallots, "community ballots are not available");

        uint id = ix.dDeployBallot(democHash, specHash, extraData, packed);
        BallotBoxIface bb = BallotBoxIface(ix.getDBallotAddr(democHash, id));

        // should we set owner to 0 so admins can't interfere with community ballots?
        bb.setOwner(address(0));

        require(bb.qualifiesAsCommunityBallot(), "must be community ballot"); // community ballots are never official or binding
    }

    // admin management

    // add an admin
    function addAdmin(address newAdmin) isAdmin() public {
        _addAdmin(newAdmin);
    }

    function _addAdmin(address newAdmin) internal {
        admins[newAdmin] = true;
        adminLog.push(newAdmin);
        emit AddedAdminToPx(newAdmin);
    }

    function removeAdmin(address oldAdmin) isAdmin() public {
        require(msg.sender != oldAdmin, "removeAdmin: you can't remove yourself");
        admins[oldAdmin] = false;
        emit RemovedAdmin(oldAdmin);
    }

    function ercOwnerClaim() external {
        require(allowErc20OwnerClaim);

        IxIface ix = IxIface(checkFwdAddressUpgrade());
        address erc20 = ix.getDErc20(democHash);
        address erc20Owner = owned(erc20).owner();

        require(erc20Owner == msg.sender, "only erc20 owner may trigger the claim");

        // note: the erc20 owner is added as an admin, not owner of the contract
        _addAdmin(erc20Owner);
    }

    function setAllowErc20OwnerClaim(bool canClaim) isAdmin() external {
        allowErc20OwnerClaim = canClaim;
    }

    // simple function to list all admins
    function listAllAdmins() public constant returns (address[]) {
        // start a dynamic memory array (note: will be replaced)
        address[] memory allAdmins;

        // main loop - check all admins in adminLog
        for(uint i = 0; i < adminLog.length; i++) {
            address nextPossibleAdmin = adminLog[i];
            if (admins[nextPossibleAdmin]) {
                allAdmins = MemArrApp.appendAddress(allAdmins, nextPossibleAdmin);
            }
        }
        return allAdmins;
    }

    function setOwnerAsAdmin() only_owner() external {
        _addAdmin(owner);
    }
}
