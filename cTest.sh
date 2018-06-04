#!/bin/bash

gap() {
  printf '\n\n###\n\n'
}

cfile=$1
cname=$2

if [ -z "$cname" ]; then
  cname=$cfile
fi

yarn c "$cfile.sol" && gap && cat "_solDist/$cname.bin" && gap && wc "_solDist/$cname.bin"
