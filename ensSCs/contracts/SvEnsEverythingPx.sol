pragma solidity ^0.4.21;

import { SvEnsRegistry } from "./SvEnsRegistry.sol";
import { PublicResolver } from "./SvEnsResolver.sol";
import { SvEnsRegistrar } from "./SvEnsRegistrar.sol";

contract SvEnsEverythingPx {
    address public owner;
    mapping (address => bool) public admins;
    address[] public adminLog;

    SvEnsRegistrar public registrar;
    SvEnsRegistry public registry;
    PublicResolver public resolver;
    bytes32 public rootNode;

    modifier only_admin() {
        require(admins[msg.sender]);
        _;
    }


    constructor(SvEnsRegistrar _registrar, SvEnsRegistry _registry, PublicResolver _resolver, bytes32 _rootNode) public {
        registrar = _registrar;
        registry = _registry;
        resolver = _resolver;
        rootNode = _rootNode;
        owner = msg.sender;
        _addAdmin(msg.sender);
    }

    function _addAdmin(address a) internal {
        admins[a] = true;
        adminLog.push(a);
    }

    function addAdmin(address a) only_admin() external {
        _addAdmin(a);
    }

    function remAdmin(address a) only_admin() external {
        require(a != owner && a != msg.sender);
        admins[a] = false;
    }

    function _regName(bytes32 labelhash) internal returns (bytes32 node) {
        registrar.register(labelhash, this);
        node = keccak256(rootNode, labelhash);
        registry.setResolver(node, resolver);
    }

    function regName(string name, address resolveTo) only_admin() external returns (bytes32 node) {
        bytes32 labelhash = keccak256(name);
        node = _regName(labelhash);
        resolver.setAddr(node, resolveTo);
        registry.setOwner(node, msg.sender);
    }

    function regNameWOwner(string name, address resolveTo, address domainOwner) only_admin() external returns (bytes32 node) {
        bytes32 labelhash = keccak256(name);
        node = _regName(labelhash);
        resolver.setAddr(node, resolveTo);
        registry.setOwner(node, domainOwner);
    }
}
