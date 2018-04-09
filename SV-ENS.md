# SecureVote ENS For Stuff!

## Kovan

* Registry: `0xd6F4f22eeC158c434b17d01f62f5dF33b108Ae93` (stores `.kov.sv` names and allows admin of them - kovan only)
* Registrar: `0xac9f51bab2a28525a1d2172ababa2be27423d48a` (admins of this registrar can register `.kov.sv` names!)
* Resolver: `0xc8c73829348cb15da4b0785a110017464fb8af51` (resolves ENS domains to addresses, text, ABIs, etc)

## Mainnet

* Registry: `0x30ff37d85c14000b6ba4192137fff59a3c22211f` (stores `.eth.sv`, `.etc.sv`, `.rop.sv`, `kov.sv` - and other names.)
* Registrar: `0x47f4A6B393a352f5e8De2bDe89Fa121e00A4835E`
* Resolver: `0xd784B7429ed0b2D0Ae9624bCFF1DE8D086f13Aa9`

### `0.secvote.eth`

The `0.secvote.eth` domain on Eth Mainnet has a registrar set up at `0x2d070f5e32b02ee44021428bbab46f4af5ffb4f4`. It allows any admins (`secvote.eth` is the only address so far with permissions) to register some subdomain of `0.secvote.eth`. It's intended that this can be used for automated creation of various names.

You can see a test of this at [max-test.0.secvote.eth](https://etherscan.io/enslookup?q=max-test.0.secvote.eth) initialized by [this tx](https://etherscan.io/tx/0x0a9b74340c59a87f874f074dfd398f5d03ff3bc3d2cf691fb44f542f9f022546).

## ENS General info

See [the ENS docs](https://docs.ens.domains/en/latest/introduction.html) for an intro overview of ENS.

## Some Domains

* `kov.sv` (Mainnet) - Points to registrar for `kov.sv` domains on Kovan
