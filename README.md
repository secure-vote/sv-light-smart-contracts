# sv-light-smart-contracts

![build-status-image](https://travis-ci.org/secure-vote/sv-light-smart-contracts.svg?branch=master)

Repo for all smart contracts associated with SV Light

## Compiling

Run `yarn compile-sv-light` to build all `.bin` and `.abi` files in `_solDist` for all contracts in `./svLight/contracts/`
## Error Handling

Error handling in solidity is annoying. For this reason _most_ contracts going forward should only use `revert`, `require`, and `assert` for really super important stuff (or where state changes may have already been made and need to be reversed).

Most of the time you should check a condition and emit an `Error` event with a status code - see `./svLight/contracts/SVCommon.sol` - particularly `descriptiveErrors`.

### Status Codes

See: `descriptiveErrors` in [./contract/contracts/SVCommon.sol](./contract/contracts/SVCommon.sol)

## Upgrading

** NOTE: WIP **

Upgradable contracts should inherit the `upgradable` SC (in `SVCommon.sol`)

It's up to each contract to implement the logic around upgrades (e.g. how to handle state).

## Scripts

See `package.json`, but you probably want to be using `yarn test` or `yarn test-watch`
