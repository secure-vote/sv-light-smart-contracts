pragma solidity ^0.4.24;

import {upgradePtr} from "./SVCommon.sol";

contract TestHelper is upgradePtr {

    struct DataAndValue {
        bytes data;
        uint value;
    }

    mapping (address => bytes) public justData;
    mapping (address => DataAndValue) public dataAndValue;
    mapping (address => uint) public justValue;

    function() external payable {
        require(msg.value != 1999, "cannot deposit 1999 wei as special value");
        justValue[msg.sender] = msg.value;
    }

    function willThrow() external payable {
        revert();
    }

    function storeData(bytes data) external {
        justData[msg.sender] = data;
    }

    function storeDataAndValue(bytes data) external payable {
        dataAndValue[msg.sender] = DataAndValue(data, msg.value);
    }

    function reentrancyHelper(address to, bytes data, uint value) external payable {
        require(to.call.value(value)(data), "tx should succeed");
    }

    function destroy(address a) external {
        selfdestruct(a);
    }
}
