pragma solidity ^0.4.21;


// Some common functions among SCs
// (c) SecureVote 2018
// Author: Max Kaye
// License: MIT
// Note: don't break backwards compatibility


// contract to enable descriptive errors that emit events through use of `doRequire`
contract descriptiveErrors {

    // general errors
    uint constant ERR_FORBIDDEN = 403;
    uint constant ERR_500 = 500;
    uint constant ERR_TESTING_REQ = 599;

    // ballot box
    uint constant ERR_BALLOT_CLOSED = 420001;
    uint constant ERR_EARLY_SECKEY = 420100;
    uint constant ERR_BAD_SUBMISSION_BITS = 420200;

    uint constant ERR_NOT_BALLOT_ETH_NO_ENC = 420400;
    uint constant ERR_NOT_BALLOT_ETH_WITH_ENC = 420401;
    uint constant ERR_NOT_BALLOT_SIGNED_NO_ENC = 420402;
    uint constant ERR_NOT_BALLOT_SIGNED_WITH_ENC = 420403;

    // democ index
    uint constant ERR_BAD_PAYMENT = 421010;
    // uint constant ERR_INDEX_FORBIDDEN = 421403;

    // admin proxy
    uint constant ERR_CANNOT_REMOVE_SELF = 428001;
    uint constant ERR_CALL_FWD_FAILED = 428500;
    uint constant ERR_PX_ETH_TFER_FAILED = 428501;
    uint constant ERR_PX_FORBIDDEN = 428403;

    // upgradable
    uint constant ERR_ALREADY_UPGRADED = 429001;
    uint constant ERR_NOT_UPGRADED = 429002;
    uint constant ERR_NO_UNDO_FOREVER = 429010;
    uint constant ERR_CALL_UPGRADED_FAILED = 429500;

    // hasAdmins
    uint constant ERR_NO_ADMIN_PERMISSIONS = 100001;

    // permissioned
    uint constant ERR_NO_EDIT_PERMISSIONS = 200001;
    uint constant ERR_ADMINS_LOCKED_DOWN = 201001;


    event Error(uint code);
    // event Passed(uint code);

    modifier req(bool condition, uint statusCode) {
        if (condition == false) {
            emit Error(statusCode);
        } else {
            _;
        }
    }

    function doRequire(bool condition, uint statusCode) internal returns (bool) {
        if (condition == false) {
            emit Error(statusCode);
        }
        return condition;
    }
}


// owned contract - added isOwner modifier (otherwise from solidity examples)
contract owned is descriptiveErrors {
    address public owner;

    event OwnerChanged(address newOwner);

    modifier only_owner() {
        if(doRequire(msg.sender == owner, ERR_FORBIDDEN)) {
            _;
        }
    }

    function owned() public {
        owner = msg.sender;
    }

    function setOwner(address newOwner) only_owner() public {
        owner = newOwner;
        emit OwnerChanged(newOwner);
    }
}


// hasAdmins contract - allows for easy admin stuff
contract hasAdmins is descriptiveErrors, owned {
    mapping (uint => mapping (address => bool)) admins;
    uint public currAdminEpoch = 0;

    event AdminAdded(address indexed newAdmin);
    event AdminRemoved(address indexed oldAdmin);
    event AdminEpochInc();
    event AdminDisabledForever();

    modifier only_admin() {
        if(doRequire(isAdmin(msg.sender), ERR_FORBIDDEN)) {
            _;
        }
    }

    function hasAdmins() public {
        admins[currAdminEpoch][msg.sender] = true;
    }

    function isAdmin(address a) view public returns (bool) {
        return admins[currAdminEpoch][a];
    }

    function setAdmin(address a, bool _givePerms) only_admin() external {
        require(a != msg.sender && a != owner);
        admins[currAdminEpoch][a] = _givePerms;
        if (_givePerms) {
            emit AdminAdded(a);
        } else {
            emit AdminRemoved(a);
        }
    }

    // safety feature if admins go bad or something
    function incAdminEpoch() only_owner() external {
        currAdminEpoch++;
        admins[currAdminEpoch][msg.sender] = true;
        emit AdminEpochInc();
    }

    function disableAdminForever() internal {
        currAdminEpoch++;
        emit AdminDisabledForever();
    }
}


// contract to enable constructing a list of addresses - due to lack of type polymorphism
// a new method is needed for arrays of different types
contract copyMemAddrArray {
    function _appendMemArray(address[] memory arr, address toAppend) internal pure returns(address[] memory arr2) {
        arr2 = new address[](arr.length + 1);

        for (uint k = 0; k < arr.length; k++) {
            arr2[k] = arr[k];
        }

        arr2[arr.length] = toAppend;
    }
}


// https://stackoverflow.com/a/40939341
contract canCheckOtherContracts {
    function isContract(address addr) constant internal returns (bool) {
        uint size;
        assembly { size := extcodesize(addr) }
        return size > 0;
    }
}


// interface for ENS reverse registrar
interface ReverseRegistrar {
    function claim(address owner) external returns (bytes32);
}


// contract to allow claiming a reverse ENS lookup
contract claimReverseENS is canCheckOtherContracts {
    function initReverseENS(address _owner) internal {
        address ensRevAddr = 0x9062C0A6Dbd6108336BcBe4593a3D1cE05512069;
        if (isContract(ensRevAddr)) {
            // 0x9062C0A6Dbd6108336BcBe4593a3D1cE05512069 is ENS ReverseRegistrar on Mainnet
            ReverseRegistrar ens = ReverseRegistrar(0x9062C0A6Dbd6108336BcBe4593a3D1cE05512069);
            ens.claim(_owner);
        }
    }
}


// is permissioned is designed around upgrading and synergistic SC networks
// the idea is that DBs and datastructs should live in their own contract
// then other contracts should use these - either to edit or read from
contract permissioned is descriptiveErrors, owned, hasAdmins {
    mapping (address => bool) editAllowed;
    bool public adminLockdown = false;

    event PermissionError(address editAddr);
    event PermissionGranted(address editAddr);
    event PermissionRevoked(address editAddr);
    event PermissionsUpgraded(address oldSC, address newSC);
    event SelfUpgrade(address oldSC, address newSC);
    event AdminLockdown();

    modifier only_editors() {
        if(doRequire(editAllowed[msg.sender], ERR_NO_EDIT_PERMISSIONS)) {
            _;
        } else {
            emit PermissionError(msg.sender);
        }
    }

    modifier no_lockdown() {
        if(doRequire(adminLockdown == false, ERR_ADMINS_LOCKED_DOWN)) {
            _;
        }
    }

    function permissioned() public {
    }

    function setPermissions(address e, bool _editPerms) no_lockdown() only_admin() external {
        editAllowed[e] = _editPerms;
        if (_editPerms)
            emit PermissionGranted(e);
        else
            emit PermissionRevoked(e);
    }

    function upgradePermissionedSC(address oldSC, address newSC) no_lockdown() only_admin() external {
        editAllowed[oldSC] = false;
        editAllowed[newSC] = true;
        emit PermissionsUpgraded(oldSC, newSC);
    }

    function upgradeMe(address newSC) only_editors() external {
        editAllowed[msg.sender] = false;
        editAllowed[newSC] = true;
        emit SelfUpgrade(msg.sender, newSC);
    }

    function hasPermissions(address a) public view returns (bool) {
        return editAllowed[a];
    }

    function doLockdown() external only_owner() {
        disableAdminForever();
        adminLockdown = true;
        emit AdminLockdown();
        owner = 0;
    }
}


contract upgradePtr {
    address ptr = address(0);

    modifier not_upgraded() {
        require(ptr == address(0));
        _;
    }

    function getUpgradePointer() constant external returns (address) {
        return ptr;
    }

    function doUpgradeInternal(address nextSC) internal {
        ptr = nextSC;
    }
}


// // allows upgrades - all methods that do stuff need the checkUpgrade modifier
// contract upgradable is descriptiveErrors, owned {
//     bool public upgraded = false;
//     address public upgradeAddr;
//     uint public upgradeTimestamp;

//     uint constant ONE_DAY_IN_SEC = 60 * 60 * 24;

//     event ContractUpgraded(uint upgradeTime, address newScAddr);

//     modifier checkUpgrade() {
//         // we want to prevent anyone but the upgrade contract calling methods - this allows
//         // the new contract to get data out of the old contract for those methods
//         // TODO: is there a case where we actually want this? Or are most methods okay to leave as old ones?
//         if (upgraded && msg.sender != upgradeAddr) {
//             doRequire(upgradeAddr.call.value(msg.value)(msg.data), ERR_CALL_UPGRADED_FAILED);
//         } else {
//             _;
//         }
//     }

//     function deprecateAndUpgrade(address _newSC) isOwner() req(upgraded == false, ERR_ALREADY_UPGRADED) public {
//         upgraded = true;
//         upgradeAddr = _newSC;
//         upgradeTimestamp = block.timestamp;
//         emit ContractUpgraded(upgradeTimestamp, upgradeAddr);
//     }

//     function undoUpgrade() isOwner()
//                            req(upgraded == true, ERR_NOT_UPGRADED)
//                            req(block.timestamp < (upgradeTimestamp + ONE_DAY_IN_SEC), ERR_NO_UNDO_FOREVER)
//                            public {
//         // todo
//     }
// }


// For ERC20Interface:
// (c) BokkyPooBah 2017. The MIT Licence.
interface ERC20Interface {
    // Get the total token supply
    function totalSupply() constant external returns (uint256 _totalSupply);

    // Get the account balance of another account with address _owner
    function balanceOf(address _owner) constant external returns (uint256 balance);

    // Send _value amount of tokens to address _to
    function transfer(address _to, uint256 _value) external returns (bool success);

    // Send _value amount of tokens from address _from to address _to
    function transferFrom(address _from, address _to, uint256 _value) external returns (bool success);

    // Allow _spender to withdraw from your account, multiple times, up to the _value amount.
    // If this function is called again it overwrites the current allowance with _value.
    // this function is required for some DEX functionality
    function approve(address _spender, uint256 _value) external returns (bool success);

    // Returns the amount which _spender is still allowed to withdraw from _owner
    function allowance(address _owner, address _spender) constant external returns (uint256 remaining);

    // Triggered when tokens are transferred.
    event Transfer(address indexed _from, address indexed _to, uint256 _value);

    // Triggered whenever approve(address _spender, uint256 _value) is called.
    event Approval(address indexed _owner, address indexed _spender, uint256 _value);
}
