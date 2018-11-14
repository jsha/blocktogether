#!/bin/bash
cd $(dirname $0)
run() {
  script=${1}
  shift
  node ${script}.js "$@" &
}

trap 'pkill -P $$' EXIT

run actions > /tmp/actions.log
run update-users > /tmp/update-users.log
run update-blocks > /tmp/update-blocks.log
run deleter > /tmp/update-blocks.log
run blocktogether --port 3000 | tee /tmp/blocktogether.log

wait
