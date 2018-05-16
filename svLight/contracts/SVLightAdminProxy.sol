pragma solidity ^0.4.22;

// Admin Proxy SC for SVDemocIndex v1.0
// (c) SecureVote 2018
// Author: Max Kaye <max@secure.vote>
// Released under MIT licence

import { owned, claimReverseENS, copyMemAddrArray, upgradePtr } from "./SVCommon.sol";
import { IxIface } from "./IndexInterface.sol";
import { SVLightBallotBox, BBSettings } from "./SVLightBallotBox.sol";
import { BallotBoxIface } from "./BallotBoxIface.sol";


contract SVLightAdminProxy is owned, copyMemAddrArray, BBSettings {
    bool public isProxyContract = true;
    uint public proxyVersion = 2;

    // storage variables
    bytes32 public democHash;
    bool public communityBallotsEnabled = true;
    mapping (address => bool) public admins;
    upgradePtr public _forwardTo;
    address[] adminLog;

    bool callActive = false;
    address caller = address(0);

    event AddedAdminToPx(address newAdmin);
    event RemovedAdmin(address oldAdmin);
    event FailedToFwdCall(uint value, bytes data);

    modifier isAdmin() {
        require(admins[msg.sender], ERR_PX_FORBIDDEN);
        _;
    }


    constructor(bytes32 _democHash, address initAdmin, address _fwdTo) public {
        // this will mostly be called by SVLightIndex so we shouldn't use msg.sender.
        democHash = _democHash;
        _addNewAdmin(initAdmin);
        _forwardTo = upgradePtr(_fwdTo);
        owner = initAdmin;
    }


    // fallback function - forwards all value and data to the `forwardTo` address.
    function() public payable {
        if (callActive) {
            // allows refunds to addresses
            caller.transfer(msg.value);
        } else {
            callActive = true;
            caller = msg.sender;

            address fwdTo = checkFwdAddressUpgrade();

            if (msg.data.length > 0) {
                require(admins[msg.sender], "must be admin to fwd data");
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

    function setCommunityBallotStatus(bool isEnabled) isAdmin() external {
        communityBallotsEnabled = isEnabled;
    }

    // flag in submissionBits that indicates if it's official or not
    function deployCommunityBallot(bytes32 specHash, bytes32 extraData, uint256 _packed) external payable returns (uint) {
        // ensure we mark this as a community ballot by disabling official and binding flags:
        // submissionBits is a uint16 that lives at [112 bits][>> 16 bits <<][128 bits]
        uint256 all1s = uint256(0) - 1;
        uint256 disallowedMask = all1s ^ (uint256(IS_OFFICIAL | IS_BINDING | USE_ENC) << 128);
        uint256 necessaryFlags = uint256(USE_NO_ENC) << 128;
        uint256 packed = (_packed | necessaryFlags) & disallowedMask;

        address fwdTo = checkFwdAddressUpgrade();
        IxIface ix = IxIface(fwdTo);

        // if accounts are not in good standing then we always allow community ballots
        bool canDoCommunityBallots = communityBallotsEnabled || !ix.accountInGoodStanding(democHash);
        require(canDoCommunityBallots, "community ballots are not available");

        uint id = ix.dDeployBallot(democHash, specHash, extraData, packed);
        BallotBoxIface bb = BallotBoxIface(ix.getDBallotAddr(democHash, id));
        bb.setOwner(msg.sender);

        require(bb.isOfficial() == false && bb.isBinding() == false, "community ballots are never official or binding");
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

    function setOwnerAsAdmin() only_owner() external {
        _addNewAdmin(owner);
    }

    // option for community stuff

}
