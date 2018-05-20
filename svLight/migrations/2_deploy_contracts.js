var StringLib = artifacts.require("./StringLib.sol");
var BPackedUtils = artifacts.require("./BPackedUtils.sol");
var SVIndex = artifacts.require("./SVLightIndex.sol");
var SVBB = artifacts.require("./SVLightBallotBox.sol");

module.exports = function(deployer) {
    deployer.deploy(StringLib);
    deployer.link(StringLib, SVIndex);

    deployer.deploy(BPackedUtils);
    deployer.link(BPackedUtils, SVIndex);
    deployer.link(BPackedUtils, SVBB);
};
