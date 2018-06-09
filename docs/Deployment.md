# Deployment of SVLight

## Prep

Initial prep needed:

* Own an ENS domain - decide what domain you'd like the index to live at.
* Deploy `SvEnsEverythingPx` with parameters:
  * `constructor(SvEnsRegistrar _registrar, SvEnsRegistry _registry, PublicResolver _resolver, bytes32 _rootNode)`
  * `_rootNode` should be the node of the ENS domain the index will live at. Example: `index.tokenvote.eth`
* Set the owner of the domain to the `SvEnsEverythingPx` (you can recover the domain)
