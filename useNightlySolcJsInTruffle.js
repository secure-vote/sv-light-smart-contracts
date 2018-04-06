#!/usr/bin/env node

// this code borrowed from https://github.com/ethereum/solc-js/blob/ce6c9892266cfff360ad2c1d4d1697dd3315b813/downloadCurrentVersion.js
// This file MIT licensed - https://github.com/ethereum/solc-js

// This is used to download the correct binary version
// as part of the prepublish step.

var fs = require('fs');
var https = require('https');
var MemoryStream = require('memorystream');
var ethJSUtil = require('ethereumjs-util');

function getVersionList (cb) {
  console.log('Retrieving available version list...');

  var mem = new MemoryStream(null, { readable: false });
  https.get('https://ethereum.github.io/solc-bin/bin/list.json', function (response) {
    if (response.statusCode !== 200) {
      console.log('Error downloading file: ' + response.statusCode);
      process.exit(1);
    }
    response.pipe(mem);
    response.on('end', function () {
      cb(mem.toString());
    });
  });
}

function downloadBinary (outputName, version, expectedHash) {
  console.log('Downloading version', version);

  // Remove if existing
  if (fs.existsSync(outputName)) {
    fs.unlinkSync(outputName);
  }

  process.on('SIGINT', function () {
    console.log('Interrupted, removing file.');
    fs.unlinkSync(outputName);
    process.exit(1);
  });

  var file = fs.createWriteStream(outputName, { encoding: 'binary' });
  https.get('https://ethereum.github.io/solc-bin/bin/' + version, function (response) {
    if (response.statusCode !== 200) {
      console.log('Error downloading file: ' + response.statusCode);
      process.exit(1);
    }
    response.pipe(file);
    file.on('finish', function () {
      file.close(function () {
        var hash = '0x' + ethJSUtil.sha3(fs.readFileSync(outputName, { encoding: 'binary' })).toString('hex');
        if (expectedHash !== hash) {
          console.log('Hash mismatch: ' + expectedHash + ' vs ' + hash);
          process.exit(1);
        }
        console.log('Done.');
      });
    });
  });
}

console.log('Downloading correct solidity binary...');

getVersionList(function (list) {
  list = JSON.parse(list);
  const releaseFileName = list.builds[list.builds.length - 1].path;
  var expectedHash = list.builds.filter(function (entry) { return entry.path === releaseFileName; })[0].keccak256;
  downloadBinary('./node_modules/solc/soljson.js', releaseFileName, expectedHash);
});
