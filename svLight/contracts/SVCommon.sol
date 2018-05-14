pragma solidity ^0.4.22;


// Some common functions among SCs
// (c) SecureVote 2018
// Author: Max Kaye
// License: MIT
// Note: don't break backwards compatibility


// contract to enable descriptive errors that emit events through use of `doRequire`
contract descriptiveErrors {

    // general errors
    string constant ERR_FORBIDDEN                   = "403";
    string constant ERR_500                         = "500";
    string constant ERR_TESTING_REQ                 = "599";

    // ballot box
    string constant ERR_BALLOT_CLOSED               = "420001";
    string constant ERR_EARLY_SECKEY                = "420100";
    string constant ERR_BAD_SUBMISSION_BITS         = "420200";
    string constant ERR_NOT_BALLOT_ETH_NO_ENC       = "420400";
    string constant ERR_NOT_BALLOT_ETH_WITH_ENC     = "420401";
    string constant ERR_NOT_BALLOT_SIGNED_NO_ENC    = "420402";
    string constant ERR_NOT_BALLOT_SIGNED_WITH_ENC  = "420403";

    // democ index
    string constant ERR_BAD_PAYMENT                 = "421010";
    string constant ERR_FAILED_TO_PROVIDE_CHANGE    = "421011";
    string constant ERR_FAILED_TO_REFUND            = "421012";
    string constant ERR_FAILED_TO_FWD_PAYMENT       = "421099";
    // string constant ERR_INDEX_FORBIDDEN          = "421403";

    // admin proxy
    string constant ERR_CANNOT_REMOVE_SELF          = "428001";
    string constant ERR_CALL_FWD_FAILED             = "428500";
    string constant ERR_PX_ETH_TFER_FAILED          = "428501";
    string constant ERR_PX_FORBIDDEN                = "428403";

    // upgradable
    string constant ERR_ALREADY_UPGRADED            = "429001";
    string constant ERR_NOT_UPGRADED                = "429002";
    string constant ERR_NO_UNDO_FOREVER             = "429010";
    string constant ERR_CALL_UPGRADED_FAILED        = "429500";

    // hasAdmin
    string constant ERR_NO_ADMIN_PERMISSIONS        = "100001";

    // permissioned
    string constant ERR_NO_EDIT_PERMISSIONS         = "200001";
    string constant ERR_ADMINS_LOCKED_DOWN          = "201001";


    event Error(uint code);
    // event Passed(uint code);

    modifier req(bool condition, string statusCode) {
        require(condition, statusCode);
        _;
    }

    function doRequire(bool condition, string statusCode) internal pure returns (bool) {
        require(condition, statusCode);
        return condition;
    }
}


// owned contract - added isOwner modifier (otherwise from solidity examples)
contract owned is descriptiveErrors {
    address public owner;

    event OwnerChanged(address newOwner);

    modifier only_owner() {
        require(msg.sender == owner, ERR_FORBIDDEN);
        _;
    }

    constructor() public {
        owner = msg.sender;
    }

    function setOwner(address newOwner) only_owner() external {
        owner = newOwner;
        emit OwnerChanged(newOwner);
    }
}


// hasAdmins contract - allows for easy admin stuff
contract hasAdmins is owned {
    mapping (uint => mapping (address => bool)) admins;
    uint public currAdminEpoch = 0;
    bool public adminsDisabledForever = false;

    event AdminAdded(address indexed newAdmin);
    event AdminRemoved(address indexed oldAdmin);
    event AdminEpochInc();
    event AdminDisabledForever();

    modifier only_admin() {
        require(isAdmin(msg.sender), ERR_FORBIDDEN);
        _;
    }

    modifier admin_not_disabled() {
        require(adminsDisabledForever == false, "admins must not be disabled");
        _;
    }

    constructor() public {
        admins[currAdminEpoch][msg.sender] = true;
    }

    function isAdmin(address a) view public returns (bool) {
        return admins[currAdminEpoch][a];
    }

    function setAdmin(address a, bool _givePerms) only_admin() admin_not_disabled() external {
        require(a != msg.sender && a != owner);
        admins[currAdminEpoch][a] = _givePerms;
        if (_givePerms) {
            emit AdminAdded(a);
        } else {
            emit AdminRemoved(a);
        }
    }

    // safety feature if admins go bad or something
    function incAdminEpoch() only_owner() admin_not_disabled() external {
        currAdminEpoch++;
        admins[currAdminEpoch][msg.sender] = true;
        emit AdminEpochInc();
    }

    function disableAdminForever() internal {
        currAdminEpoch++;
        adminsDisabledForever = true;
        emit AdminDisabledForever();
    }
}




// allow converting toBase58 from bytes
contract toBase58C {
    // base58 stuff copied from https://github.com/MrChico/verifyIPFS/blob/b4bfb3df52e7e012a4ef668c6b3dbc038f881fd9/contracts/verifyIPFS.sol
    // MIT Licensed - https://github.com/MrChico/verifyIPFS/blob/b4bfb3df52e7e012a4ef668c6b3dbc038f881fd9/LICENSE
    bytes constant ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    /// @dev Converts hex string to base 58
    function toBase58(bytes source) pure internal returns (bytes) {
        if (source.length == 0) return new bytes(0);
        uint8[] memory digits = new uint8[](40); //TODO: figure out exactly how much is needed
        digits[0] = 0;
        uint8 digitlength = 1;
        for (uint8 i = 0; i<source.length; ++i) {
            uint carry = uint8(source[i]);
            for (uint8 j = 0; j<digitlength; ++j) {
                carry += uint(digits[j]) * 256;
                digits[j] = uint8(carry % 58);
                carry = carry / 58;
            }

            while (carry > 0) {
                digits[digitlength] = uint8(carry % 58);
                digitlength++;
                carry = carry / 58;
            }
        }
        //return digits;
        return toAlphabet(reverse(truncate(digits, digitlength)));
    }

    function truncate(uint8[] array, uint8 length) pure internal returns (uint8[]) {
        uint8[] memory output = new uint8[](length);
        for (uint8 i = 0; i<length; i++) {
            output[i] = array[i];
        }
        return output;
    }

    function reverse(uint8[] input) pure internal returns (uint8[]) {
        uint8[] memory output = new uint8[](input.length);
        for (uint8 i = 0; i<input.length; i++) {
            output[i] = input[input.length-1-i];
        }
        return output;
    }

    function toAlphabet(uint8[] indices) pure internal returns (bytes) {
        bytes memory output = new bytes(indices.length);
        for (uint8 i = 0; i<indices.length; i++) {
            output[i] = ALPHABET[indices[i]];
        }
        return output;
    }
}


// base58 utils for creating ENS domains from democHash prefixes
contract base58EnsUtils is toBase58C {
    function b13ToBytes(bytes13 b13) pure internal returns(bytes) {
        bytes memory bs = new bytes(13);
        for (uint i = 0; i < 13; i++) {
            bs[i] = b13[i];
        }
        return bs;
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


// contract to enable constructing a list of bytes32 - due to lack of type polymorphism
// a new method is needed for arrays of different types
contract copyMemBytes32Array {
    function _appendB32MemArray(bytes32[] memory arr, bytes32 toAppend) internal pure returns(bytes32[] memory arr2) {
        arr2 = new bytes32[](arr.length + 1);

        for (uint k = 0; k < arr.length; k++) {
            arr2[k] = arr[k];
        }

        arr2[arr.length] = toAppend;
    }
}


// contract to enable constructing a list of uint256 - due to lack of type polymorphism
// a new method is needed for arrays of different types
contract copyMemUint256Array {
    function _appendUint256MemArray(uint256[] memory arr, uint256 toAppend) internal pure returns(uint256[] memory arr2) {
        arr2 = new uint256[](arr.length + 1);

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
interface ReverseRegistrarIface {
    function claim(address owner) external returns (bytes32);
}


// contract to allow claiming a reverse ENS lookup
contract claimReverseENS is canCheckOtherContracts {
    function initReverseENS(address _owner) internal {
        // 0x9062C0A6Dbd6108336BcBe4593a3D1cE05512069 is ENS ReverseRegistrar on Mainnet
        address ensRevAddr = 0x9062C0A6Dbd6108336BcBe4593a3D1cE05512069;
        if (isContract(ensRevAddr)) {
            ReverseRegistrarIface ens = ReverseRegistrarIface(ensRevAddr);
            ens.claim(_owner);
        }
    }
}


// is permissioned is designed around upgrading and synergistic SC networks
// the idea is that DBs and datastructs should live in their own contract
// then other contracts should use these - either to edit or read from
contract permissioned is owned, hasAdmins {
    mapping (address => bool) editAllowed;
    bool public adminLockdown = false;

    event PermissionError(address editAddr);
    event PermissionGranted(address editAddr);
    event PermissionRevoked(address editAddr);
    event PermissionsUpgraded(address oldSC, address newSC);
    event SelfUpgrade(address oldSC, address newSC);
    event AdminLockdown();

    modifier only_editors() {
        require(editAllowed[msg.sender], ERR_NO_EDIT_PERMISSIONS);
        _;
    }

    modifier no_lockdown() {
        require(adminLockdown == false, ERR_ADMINS_LOCKED_DOWN);
        _;
    }


    constructor() owned() hasAdmins() public {
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

    // always allow SCs to upgrade themselves, even after lockdown
    function upgradeMe(address newSC) only_editors() external returns (bool) {
        editAllowed[msg.sender] = false;
        editAllowed[newSC] = true;
        emit SelfUpgrade(msg.sender, newSC);
        return true;
    }

    function hasPermissions(address a) public view returns (bool) {
        return editAllowed[a];
    }

    function doLockdown() external only_owner() no_lockdown() {
        disableAdminForever();
        adminLockdown = true;
        emit AdminLockdown();
    }
}


contract upgradePtr {
    address ptr = address(0);

    modifier not_upgraded() {
        require(ptr == address(0), "upgrade pointer is non-zero");
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
