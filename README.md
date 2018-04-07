# sv-light-smart-contracts
Repo for all smart contracts associated with SV Light

## Error Handling

Error handling in solidity is annoying. For this reason contracts going forward should only use `revert`, `require`, and `assert` for really super important stuff (or where state changes may have already been made). 

Most of the time you should check a condition and emit an `Error` event with a status code.

### Status Codes

#### General

* 403: forbidden
* 500: Internal error somewhere (no more details available)
* 599: Testing mode required but not enabled

#### Ballot Box

* 420001: Ballot closed (timestamp)

#### Upgradable

* 429001: 