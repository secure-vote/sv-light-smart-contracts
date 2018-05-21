pragma solidity ^0.4.24;


contract TestHelper {

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
        justData[address(0)] = "test123";
    }

    function storeData(bytes data) external {
        justData[msg.sender] = data;
    }

    function storeDataAndValue(bytes data) external payable {
        dataAndValue[msg.sender] = DataAndValue(data, msg.value);
    }

}
