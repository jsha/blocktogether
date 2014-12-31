#!/bin/bash
cd $(dirname $0)
run() {
  js ${1}.js &
}

trap 'pkill -P $$' EXIT

run blocktogether
run stream
run actions
run update-users
run update-blocks

while :; do sleep 10000 ; done
