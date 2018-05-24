pragma solidity 0.4.24;


interface OwnedIface {
    function getOwner() external view returns (address);
    function setOwner(address) external;
}
