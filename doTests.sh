#!/bin/bash

if [[ -n "$TRAVIS" || -n "$RUN_ALL_TESTS" ]]; then
  export TEST_ADD_BBFARMS=true
fi

yarn run truffle test $1

