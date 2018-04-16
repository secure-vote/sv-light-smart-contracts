pragma solidity ^0.4.21;

// MIT
// Author: Max Kaye, SecureVote
// Copyright SecureVote 2018
// ----------------------------
// Triggerable.sol
// This interface defines something that can be triggered in a number of ways.
// The idea is it recieves a single bytes32, and then it can manage
// doing whatever it wants with that. This allows, for example, SV Light's democracy
// index to only call once out to some Triggerable contract which then fwds anything
// it wants to other contracts.


interface Triggerable {
    function handle(bytes32[] ref) external;
}
