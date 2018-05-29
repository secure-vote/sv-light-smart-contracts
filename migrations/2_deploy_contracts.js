var StringLib = artifacts.require("./StringLib.sol");
var BPackedUtils = artifacts.require("./BPackedUtils.sol");
var SVIndex = artifacts.require("./SVLightIndex.sol");

var BBLib = artifacts.require("BBLib")
var BBFarm = artifacts.require("BBFarm")

module.exports = function(deployer) {
    deployer.deploy(StringLib);
    deployer.deploy(BBLib)
    // deployer.deploy(BPackedUtils);

    deployer.link(StringLib, SVIndex);
    // deployer.link(BPackedUtils, SVIndex);
    deployer.link(BBLib, SVIndex)

    deployer.link(BBLib, BBFarm)
};
