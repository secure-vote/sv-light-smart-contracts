var BPackedUtils = artifacts.require("./BPackedUtils.sol");
var SVIndex = artifacts.require("./SVIndex.sol");

var BBLib = artifacts.require("BBLib")
var BBFarm = artifacts.require("BBFarm")

module.exports = function(deployer) {
    deployer.deploy(BBLib)
    // deployer.deploy(BPackedUtils);

    // deployer.link(BPackedUtils, SVIndex);
    deployer.link(BBLib, SVIndex)

    deployer.link(BBLib, BBFarm)
};
