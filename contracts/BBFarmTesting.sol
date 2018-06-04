pragma solidity ^0.4.24;


contract BBFarmTesting {
    // namespaces should be unique for each bbFarm
    bytes4 NAMESPACE;

    event BBFarmInit(bytes4 namespace);

    constructor(bytes4 ns) public {
        NAMESPACE = ns;
        emit BBFarmInit(ns);
    }

    function getNamespace() external view returns (bytes4) {
        return NAMESPACE;
    }
}
