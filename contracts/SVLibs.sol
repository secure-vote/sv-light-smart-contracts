pragma solidity 0.4.24;


library ownedLib {
    struct Owned {
        address owner;
    }

    event OwnerChanged(address newOwner);

    function init(Owned storage o) external {
        o.owner = msg.sender;
    }

    function requireOnlyOwner(Owned storage o) external view {
        require(msg.sender == o.owner, "must be owner");
    }

    function setOwner(Owned storage o, address newOwner) external {
        o.owner = newOwner;
        emit OwnerChanged(newOwner);
    }

    function getOwner(Owned storage o) external view returns (address) {
        return o.owner;
    }
}


contract OwnedWLib {
    using ownedLib for ownedLib.Owned;

    ownedLib.Owned o;

    modifier only_owner() {
        o.requireOnlyOwner();
        _;
    }

    constructor() public {
        o.init();
    }

    function owner() public view returns (address) {
        return o.owner;
    }

    function setOwner(address newOwner) only_owner() external {
        o.setOwner(newOwner);
    }

    function getOwner() external view returns (address) {
        return o.owner;
    }
}
