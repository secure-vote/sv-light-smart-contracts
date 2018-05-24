#!/bin/bash

gap() {
  printf '\n\n###\n\n'
}

yarn c "$1.sol" && gap && cat "_solDist/$1.bin" && gap && wc "_solDist/$1.bin"

