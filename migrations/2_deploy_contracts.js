var StringLib = artifacts.require("./StringLib.sol");
var BPackedUtils = artifacts.require("./BPackedUtils.sol");
var SVIndex = artifacts.require("./SVLightIndex.sol");
var SVBB = artifacts.require("./SVLightBallotBox.sol");

var OwnedWLib = artifacts.require("OwnedWLib")
var ownedLib = artifacts.require("ownedLib")

var BBLib = artifacts.require("BBLib")
var BBInstance = artifacts.require("BBInstance")

module.exports = function(deployer) {
    deployer.deploy(StringLib);
    deployer.link(StringLib, SVIndex);

    deployer.deploy(BPackedUtils);
    deployer.link(BPackedUtils, SVIndex);
    deployer.link(BPackedUtils, SVBB);

    deployer.deploy(ownedLib);
    deployer.link(ownedLib, OwnedWLib);

    deployer.deploy(BBLib)
    deployer.link(BBLib, BBInstance)
    deployer.link(ownedLib, BBInstance)
};
