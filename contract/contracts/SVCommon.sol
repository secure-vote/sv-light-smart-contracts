pragma solidity ^0.4.21;


// Some common functions among SCs
// (c) SecureVote 2018
// Author: Max Kaye
// License: MIT
// Note: don't break backwards compatibility


// contract to enable descriptive errors that emit events through use of `doRequire`
contract descriptiveErrors {
    event Error(string error);

    function doRequire(bool condition, string errMsg) internal {
        if (condition == false) {
            // note: this doesn't actually work unless we return from the function successfully (i.e. with `return`)
            emit Error(errMsg);
            return;
        }
        require(condition);
    }
}


// owned contract - added isOwner modifier (otherwise from solidity examples)
contract owned is descriptiveErrors {
    address public owner;

    modifier isOwner() {
        doRequire(msg.sender == owner, "Sender is not owner.");
        _;
    }

    function owned() public {
        owner = msg.sender;
    }

    function setOwner(address newOwner) isOwner() public {
        owner = newOwner;
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


// allows upgrades - all methods that do stuff need the checkUpgrade modifier
contract upgradable is descriptiveErrors, owned {
    bool public upgraded = false;
    address public upgradeAddr;
    uint public upgradeTimestamp;

    event ContractUpgraded(uint upgradeTime, address newScAddr);

    modifier checkUpgrade() {
        // we want to prevent anyone but the upgrade contract calling methods - this allows
        // the new contract to get data out of the old contract for those methods
        // TODO: is there a case where we actually want this? Or are most methods okay to leave as old ones?
        if (upgraded && msg.sender != upgradeAddr) {
            doRequire(upgradeAddr.call.value(msg.value)(msg.data), "unable to forward data to upgrade contract - some error occured");
        } else {
            _;
        }
    }

    function deprecateAndUpgrade(address _newSC) isOwner() public {
        doRequire(upgraded == false, "cannot upgrade a contract more than once");
        upgraded = true;
        upgradeAddr = _newSC;
        upgradeTimestamp = block.timestamp;
        emit ContractUpgraded(upgradeTimestamp, upgradeAddr);
    }

    function undoUpgrade() isOwner() public {
        doRequire(upgraded == true, "cannot do an upgrade that hasn't occured");
        uint oneDay = (60 * 60 * 24);
        doRequire(block.timestamp < (upgradeTimestamp + oneDay), "can only undo upgrade in first 24 hrs");
    }
}


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






// Empty contract for testing purposes
contract SVCommon is descriptiveErrors, owned, claimReverseENS, upgradable {

}
