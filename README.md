# sv-light-smart-contracts

[![build-status-image](https://travis-ci.org/secure-vote/sv-light-smart-contracts.svg?branch=master)](https://travis-ci.org/secure-vote/sv-light-smart-contracts)

Repo for all smart contracts associated with SV Light

## Compiling

Run `yarn compile-sv-light` to build all `.bin` and `.abi` files in `_solDist` for all contracts in `./svLight/contracts/`
## Error Handling

Error handling in solidity is annoying. ~~For this reason _most_ contracts going forward should only use `revert`, `require`, and `assert` for really super important stuff (or where state changes may have already been made and need to be reversed).~~

Luckily with 0.4.22 we can return strings in `revert`s now. (Though tooling needs to be updated as of 2018/4/19). All errors should `revert` and not allow the tx to go through.

~~Most of the time you should check a condition and emit an `Error` event with a status code - see `./svLight/contracts/SVCommon.sol` - particularly `descriptiveErrors`.~~

### Status Codes

See: `descriptiveErrors` in [./contract/contracts/SVCommon.sol](./contract/contracts/SVCommon.sol)

## Upgrading

-- todo

## Scripts

See `package.json`, but you probably want to be using `yarn test` or `yarn test-watch`


## Deploying SvIndex

1. deploy SVIndexBackend and note the address (0x7F0cCC57AfaB17bD549D763E9C117EBAE0154F14)
2. deploy SVIndexPaymentSettings and note address
3. (Note: you should have already deployed )

### Changing Payment Settings

You'll need to interact with the paymentSettings SC used by the democIndex (this is so settings persist with SVIndexUpgrades).
