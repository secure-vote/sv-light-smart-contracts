var BPackedUtils = artifacts.require("./BPackedUtils.sol");
var SVIndex = artifacts.require("./SVIndex.sol");

var BBLib = artifacts.require("BBLib")
var BBLibV7 = artifacts.require("BBLibV7")
var BBFarm = artifacts.require("BBFarm")
var RemoteBBFarm = artifacts.require("RemoteBBFarm")

module.exports = function(deployer) {
    deployer.deploy(BBLib)
    // deployer.deploy(BPackedUtils);

    // deployer.link(BPackedUtils, SVIndex);
    deployer.link(BBLib, SVIndex)

    deployer.link(BBLib, BBFarm)

    deployer.link(BBLibV7, RemoteBBFarm)
};
