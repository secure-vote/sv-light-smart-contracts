# BBFarm on other networks

**Intent**: allow a BBFarm to be deployed on networks other than Eth-Mainnet and unique references to be generated securely.

### Requirements

Still need to integrate with Ix, this means whatever ballotId is generated on mainnet needs to be identical to one generated on the foreign network.

So we'll need a proxy BBFarm set up on mainnet to populate and link up with ix, but also allow identical deployment.

We can use the namespace to indicate a foreign network (first byte).

* `0x00------` namespaces are on Eth mainnet
* `0x01------` namespaces are on Eth classic

BBFarms (the proxy on mainnet and real one on classic) should have the same namespace (duh).

### Data flow stuff

* Mainnet
    * User inits a ballot, however they choose.
    * User specifies the BBFarm via the first byte of extradata
    * Ix sends message to BBFarm to store the ballot (note: this does store the ballot on mainnet in the usual way, but the bbfarm should have a "pointer" to the foreign network and refuse to store any votes (auto-revert))
    * BBFarm returns a ballotId that can be deterministically generated on both networks.

* Classic (or foreign)
    * User manually inits a ballot by calling the appropriate function on the BBFarm (`initBallot`)
    * Classic BBFarm deterministically generates same ballotId as mainnet BBFarm proxy.

### Deterministic ballotId gen

* We have to be careful about the `packed` param here b/c existing BBFarms can edit it (startTime particularly I think)

Choice: allow BBFarm to edit startTime in this case?
- perhaps order should be: deploy ballot to classic (allowing the alteration of startTime to avoid manipulation), then _alter_ the startTime (submitted to the main BBFarm) to match that in classic.

Params that need to be included in the calculation of the ballotId:
* user's address (note: this means the _same_ address must be used for both classic and mainnet - safe way feels like: do this via proxy and use ecrecover)
* specHash
* packed (esp the startTime, etc)
* extraData (as bytes24, not the bytes16 stored in the ballot)

* index? Probs not but need to figure out how to deal with it proper.


### Questions that need answering

* How to deal with sponsorship? No community ballots? Hardcoded? Fake index on foreign network?
