#!/bin/bash

set -e

rm -r ./_solDist/* || true

for f in $(ls ./contracts | grep "sol$"); do
    ./bin/compile.sh -d contracts -c $f;
done

for f in $(ls ./_solDist/ | grep bin \
                          | grep -v Iface \
                          | grep -v Interface \
                          | grep -v hasVersion \
                          | grep -v payoutAllCSettable \
                          ); do
    if [ "$(wc -c ./_solDist/$f | xargs | cut -d ' ' -f 1)" -eq "0" ]; then
        echo "ERROR: Null binary detected for $(basename $f | cut -d '.' -f 1)"
        echo "If this is okay (the contract is abstract) then add it to the list of exceptions in compileAllSvLight.sh"
        echo "if you shouldn't get this error, see https://github.com/ethereum/solidity/issues/4220"
        exit 1
    fi
done

echo "Compiled all contracts successfully."
