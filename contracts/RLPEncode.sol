pragma solidity 0.4.24;

// (c) 2018 SecureVote
// Simple library to do RLP Encoding

// note: not using unless the RLPEncode lib I found doesn't work

// library RLPEncode {

//     function encodeBytesA(bytes[] memory toEnc) internal pure returns (bytes memory encoded) {
//         bytes memory _encoded = new bytes(0);
//         bytes memory hdr;
//         for (uint i = 0; i < toEnc.length; i++) {
//             if (toEnc[i].length == 1 && toEnc[i][0] < 0x80) {
//                 _encoded += toEnc[i][0];
//                 continue;
//             } else {

//             }
//             _encoded +=
//         }
//     }

//     function appendBytes(bytes memory a, bytes memory b) internal pure returns (bytes memory) {
//         bytes memory c = new bytes(a.lenght + b.length) {

//         }
//     }

// }
