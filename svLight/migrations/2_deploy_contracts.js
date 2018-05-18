var StringLib = artifacts.require("./StringLib.sol");
var SVIndex = artifacts.require("./SVLightIndex.sol");

module.exports = function(deployer) {
    deployer.deploy(StringLib);
    deployer.link(StringLib, SVIndex);
};
