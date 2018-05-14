# sv-light-smart-contracts

[![build-status-image](https://travis-ci.org/secure-vote/sv-light-smart-contracts.svg?branch=master)](https://travis-ci.org/secure-vote/sv-light-smart-contracts)

Repo for all smart contracts associated with SV Light

## Compiling

Run `yarn compile-sv-light` to build all `.bin` and `.abi` files in `_solDist` for all contracts in `./svLight/contracts/`

## Error Handling

Error handling in solidity is annoying. ~~For this reason _most_ contracts going forward should only use `revert`, `require`, and `assert` for really super important stuff (or where state changes may have already been made and need to be reversed).~~

Luckily with 0.4.22 we can return strings in `revert`s now. (Though tooling needs to be updated as of 2018/4/19). All errors should `revert` and not allow the tx to go through.

~~Most of the time you should check a condition and emit an `Error` event with a status code - see `./svLight/contracts/SVCommon.sol` - particularly `descriptiveErrors`.~~

## Naming Conventions

Public methods (excluding the ballot box) use the following conventions:

* getters are prefixed with `get`, and optionally have some extra info afterwards, e.g. `getD...` methods are getters for various democracy data, and `getG...` is a getter for some global info. There are some exceptions like `accountInGoodStanding`.
* setters are like getters but prefixed with `set`
* there are also "action" methods that do something, they're prefixed with `do` or a letter indicating their scope, e.g. `dInit` inits a democracy, and `dAddBallot` adds a ballot to a democracy. There are some exceptions where it makes sense, e.g. `payForDemocracy`.

## Scripts

See `package.json`, but you probably want to be using `yarn test` or `yarn test-watch`


## Deploying SvIndex

### Fresh

1. deploy SVIndexBackend and note the address
2. deploy SVIndexPaymentSettings and note address
3. (Note: you should have already deployed the admin proxy factory, the ballot box factory, and the ens everything px)
4. deploy SVLightIndex with parameters (and note the new Ix's address)
  1. IxBackend address
  2. PaymentSettings address
  3. AdminPxFactory address
  4. BallotBoxFactory address
  5. ENSEverythingPx address
5. Set new Ix as editor on Backend and PaymentSettings (by calling `setPermissions()` then call `doLockdown()`)
6. Set new Ix as admin on EnsEverythingPx
7. Update an ENS domains you need to.
7. Done!

### Upgrading

Unless you're also upgrading any component:

1. Deploy SvLightIndex with relevant parameters (probs the same as the last Ix)
2. Run `doUpgrade()` on the previous Ix from the owner address (it'll do everything else)
3. Confirm by checking `upgradePtr()` on the old Ix

### Changing Payment Settings

You'll need to interact with the paymentSettings SC used by the democIndex (this is so settings persist with SVIndexUpgrades).
