# Deployment of SVLight

## Prep

Initial prep needed:

* Own an ENS domain - decide what domain you'd like the index to live at.
* Deploy `EnsOwnerProxy` with parameters:
  * `constructor(bytes32 _ensNode, ENSIface _ens, PublicResolver _resolver)`
  * `_ensNode` should be the node of the ENS domain the index will live at. Example: `index.tokenvote.eth` corresponds to `0x5bc52185477f1fb191d0a118f3f0a82d0032bc283c62f0f818a0ddee0127d9ba`
* Set the owner of the domain to the `EnsOwnerProxy` (you can recover the domain)

## Main Deploy

**WARNING:** if you would like to deploy the index in such a way that the code can be verified through etherscan you should use `solidity_flattener` to generate the `.sol` file, use `solc` to compile that with whatever flags, and then deploy _that_ code, not the code provided to you when deploying the index below. Note, however, that you will need to ensure the constructor arguments are correctly attached to the index when deploying.

**Actual Deployment**

You can use `./bin/deploy-ix-full.js` to deploy the contract. Be sure to check `--help`. Be sure to provide:
* emergency payments addr
* the owner addr if deploying manually
* ensOwnerPx address
* the ens domain being used
* `--fresh`


In order these are deployed: (construct args follow name)

* SVIndexBackend - `()`
* SVPayments - `(address _emergencyAdmin)`
* BBFarm - `()`
* CommunityAuction - `()`
* Index - `(backend, payments, ensOwnerProxy, bbfarm, commAuciton)`

Then you'll need to set permissions on:

* Backend
* Payments
* BBFarm
* EnsOwnerPx

And finally set the ens addr to resolve to the index.

### Full log:

```
node ./bin/deploy-ix-full.js --ensIxDomain index-test.kov.sv --fresh --ensOwnerProxy 0xFd8046d5dC6AeF7b28c9F6CeCb94D0fEcC444215 --ownerAddr 0xc45797d1a7accc9fb2dcb054aa907f303a0a08f8 --paymentsEmergencyAdmin 0xEB25836BE37E8Dd1163F5A2C0F5E3D92Af5BB4D5
Deployment of SVIndexBackend ready.
Binary data to deploy has been copied to clipboard.
Gas to use:
          3787447

>> Please deploy this binary to the network from the designated owner <<

? What is the address of the deployed SVIndexBackend contract? 0x66F45dF94cc5DE40aC6c4Ded42df73359955e2
7c

##############

Deployment of SVPayments ready.
Binary data to deploy has been copied to clipboard.
Gas to use:
          3708724

>> Please deploy this binary to the network from the designated owner <<
? What is the address of the deployed SVPayments contract? 0x45479de1938f049c1b5Ea7825a959723Cd22927C

##############

Deployment of BBFarm ready.
Binary data to deploy has been copied to clipboard.
Gas to use:
          3072111

>> Please deploy this binary to the network from the designated owner <<

? What is the address of the deployed BBFarm contract? 0x7ecdfd9375bE8CA11deb0ea0e9ac890BB021BACE

##############

Deployment of CommunityAuctionSimple ready.
Binary data to deploy has been copied to clipboard.
Gas to use:
          507412

>> Please deploy this binary to the network from the designated owner <<

? What is the address of the deployed CommunityAuctionSimple contract? 0x29D759c3b1aA55C0427cffC8bB9017
4089854fB4

##############

About to deploy Index

Deployment of SVIndex ready.
Binary data to deploy has been copied to clipboard.
Gas to use:
          4865878

>> Please deploy this binary to the network from the designated owner <<
? What is the address of the deployed SVIndex contract? 0x3FA190beB7a7617b97356c00EAcdB3A86BA484fD

##############

Index deployed to 0x3FA190beB7a7617b97356c00EAcdB3A86BA484fD!
We need to set index permissions on backend and payments
Setting permissions on backend

>> Please send 0x6165234c0000000000000000000000003fa190beb7a7617b97356c00eacdb3a86ba484fd0000000000000000000000000000000000000000000000000000000000000001 to 0x66F45dF94cc5DE40aC6c4Ded42df73359955e27c <<

? Press enter when done. true
Setting permissions on payments

>> Please send 0x6165234c0000000000000000000000003fa190beb7a7617b97356c00eacdb3a86ba484fd0000000000000000000000000000000000000000000000000000000000000001 to 0x45479de1938f049c1b5Ea7825a959723Cd22927C <<

? Press enter when done. true
Setting permissions on bbfarm

>> Please send 0x6165234c0000000000000000000000003fa190beb7a7617b97356c00eacdb3a86ba484fd0000000000000000000000000000000000000000000000000000000000000001 to 0x7ecdfd9375bE8CA11deb0ea0e9ac890BB021BACE <<

? Press enter when done. true
Done!
Next we need to configure the ens stuff.

##############

Adding index as admin to ensOwnerPx

>> Please send 0x4b0bddd20000000000000000000000003fa190beb7a7617b97356c00eacdb3a86ba484fd0000000000000000000000000000000000000000000000000000000000000001 to 0xFd8046d5dC6AeF7b28c9F6CeCb94D0fEcC444215 <<

? Press enter when done. true
Added index as admin to ensOwnerPx in <User Initiated Transaction>
Setting index-test.kov.sv to resolve to index

>> Please send 0xd1d80fdf0000000000000000000000003fa190beb7a7617b97356c00eacdb3a86ba484fd to 0xFd8046d5dC6AeF7b28c9F6CeCb94D0fEcC444215 <<

? Press enter when done. true
Set index-test.kov.sv to resolve to index at 0x3FA190beB7a7617b97356c00EAcdB3A86BA484fD in <User Initiated Transaction>
Main returned.
```

## Note for test deploy

* domain: index-test.kov.sv
* node: 0xe49c4a50ad27b10454f9a34794184ff041357887285019c6b33476b074126606


## Notes for Prod:

Addresses:

* 0x60576481625B6dF2a629c9d7dfe9417aecdB324a
* 0xEB25836BE37E8Dd1163F5A2C0F5E3D92Af5BB4D5
* 0xE5024AcCa13687B908FEfc82D4D30036d77c538e
* 0xAD7e28ae15D160487866d761bDF96Df1AAB09698
* 0x384d5826508CA79C3536D4A6D383D19bE3B077F3
