#!/bin/bash

echo "Use RUN_ALL_TESTS=true to run all tests."
if [ -n "$TRAVIS" ] || [ -n "$RUN_ALL_TESTS" ]; then
  echo "Loading all env vars"
  set -x
  export TEST_ADD_BBFARMS=true
  set +x
fi

yarn run truffle test $1
