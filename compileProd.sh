#!/bin/bash

set -e

DIST_DIR="dist"
C_SRC_DIR="contracts"
SOLC_VER=$(solc --version | tail -n 1 | cut -d ' ' -f 2 | cut -d '+' -f 1)

rm -rf ./$DIST_DIR/* || true
mkdir -p $DIST_DIR || true

doSvCompile(){
    cname="$(echo $1 | sed 's/\.sol$//g')"
    cfile="$cname.sol"
    dist_src="$DIST_DIR/$cfile"
    # sensible snake case
    distname=$(echo "$cname" | sed -E 's/([A-Z])([a-z])/_\L\1\2/g' | sed -E 's/([A-Z])([A-Z]*)/_\L\1\L\2/g' | sed 's/^_//')
    outdir="dist/$distname"
    solidity_flattener "./$C_SRC_DIR/$cfile" --solc-paths './lib,./ens,' > "$dist_src"
    sed -i "s/pragma solidity \^0\.4\.13;/pragma solidity $SOLC_VER;/" "$dist_src"
    mkdir -p "$outdir"
    ./bin/compile.sh -d "$DIST_DIR" -c "$cfile" -o "$outdir"
    echo "-------------"
    echo "$cname compile to $outdir"
    echo "-------------"
}

doSvCompile SVIndex
doSvCompile SVIndexBackend
doSvCompile SVPayments
doSvCompile BBFarm
doSvCompile CommunityAuction
doSvCompile EnsOwnerProxy
