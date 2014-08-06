#!/bin/bash -ex
rsync -avu ./ owb:/usr/local/blocktogether/`date +%Y%m%d-%H%m%S`
