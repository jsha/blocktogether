#!/bin/bash
js blocktogether.js >> /tmp/bt.blocktogether.log 2>&1 &
js stream.js >> /tmp/bt.stream.log 2>&1 &
js actions.js >> /tmp/bt.actions.log 2>&1 &
js update-blocks.js >> /tmp/bt.update-blocks.log 2>&1 &
js update-users.js >> /tmp/bt.update-users.log 2>&1 &
