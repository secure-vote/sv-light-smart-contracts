#!/bin/bash

rm -r ./_solDist/*

for f in $(ls ./contracts | grep sol); do
    ./bin/compile.sh -d contracts -c $f;
done

for f in $(ls ./_solDist/ | grep bin | grep -v Iface | grep -v Interface); do
    if [ "$(wc -c ./_solDist/$f | xargs | cut -d ' ' -f 1)" -eq "0" ]; then
        echo "ERROR: Null binary detected for $(basename $f | cut -d '.' -f 1)"
        exit 1
    fi
done

echo "Compiled all contracts successfully."
