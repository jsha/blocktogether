#!/bin/bash
cd $(dirname $0)
run() {
  (while :; do
     js ${1}.js >> /tmp/bt.${1}.log 2>&1
   done) &
}

run blocktogether
run stream
run actions
run update-users
run update-blocks
