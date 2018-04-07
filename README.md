# sv-light-smart-contracts
Repo for all smart contracts associated with SV Light

## Error Handling

Error handling in solidity is annoying. For this reason contracts going forward should only use `revert`, `require`, and `assert` for really super important stuff (or where state changes may have already been made).

Most of the time you should check a condition and emit an `Error` event with a status code.

### Status Codes

See: `descriptiveErrors` in [./contract/contracts/SVCommon.sol](./contract/contracts/SVCommon.sol)

## Upgrading

Upgradable contracts should inherit the `upgradable` SC (in `SVCommon.sol`)

It's up to each contract to implement the logic around upgrades (e.g. how to handle state).


## Scripts

See `package.json`, but you probably want to be using `yarn test` or `yarn test-watch`