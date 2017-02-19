#!/bin/bash
cd $(dirname $0)
run() {
  node ${1}.js &
}

trap 'pkill -P $$' EXIT

run stream > /tmp/stream.log
run actions > /tmp/actions.log
run update-users > /tmp/update-users.log
run update-blocks > /tmp/update-blocks.log
run deleter > /tmp/update-blocks.log
run blocktogether | tee /tmp/blocktogether.org

wait
