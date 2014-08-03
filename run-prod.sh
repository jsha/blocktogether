#!/bin/bash
js blocktogether.js > /tmp/blocktogether.log 2>&1 &
js stream.js > /tmp/stream 2>&1 &
js actions.js > /tmp/actions 2>&1 &
js update-blocks.js > /tmp/update-blocks 2>&1 &
js update-users.js > /tmp/update-users 2>&1 &
