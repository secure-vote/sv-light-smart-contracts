var StringLib = artifacts.require("./StringLib.sol");
var BPackedUtils = artifacts.require("./BPackedUtils.sol");
var SVIndex = artifacts.require("./SVLightIndex.sol");
var SVBB = artifacts.require("./SVLightBallotBox.sol");

var OwnedWLib = artifacts.require("OwnedWLib")
var ownedLib = artifacts.require("ownedLib")

var BBLib = artifacts.require("BBLib")
var BBInstance = artifacts.require("BBInstance")
var BBFarm = artifacts.require("BBFarm")

var SVBBoxFactory = artifacts.require("SVBBoxFactory")

module.exports = function(deployer) {
    deployer.deploy(StringLib);
    deployer.deploy(BBLib)
    deployer.deploy(BPackedUtils);
    deployer.deploy(ownedLib);

    deployer.link(StringLib, SVIndex);
    deployer.link(BPackedUtils, SVIndex);
    deployer.link(BBLib, SVIndex)

    deployer.link(BPackedUtils, SVBB);

    deployer.link(ownedLib, OwnedWLib);

    deployer.link(BBLib, BBInstance)
    deployer.link(ownedLib, BBInstance)

    deployer.link(BBLib, SVBBoxFactory)
    deployer.link(ownedLib, SVBBoxFactory)

    deployer.link(BBLib, BBFarm)
};
