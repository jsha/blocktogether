#!/bin/bash

set -e

cd "$(dirname ${BASH_SOURCE[0]})/../../"

sudo install -o "$USER" -d /etc/blocktogether
sudo install -o "$USER" -d /data/blocktogether

cp -a ./config/* /etc/blocktogether/
sed "s/__CONSUMER_KEY__/$CONSUMER_KEY/" ./config/development.json > /etc/blocktogether/config.json
sed -i "s/__CONSUMER_SECRET__/$CONSUMER_SECRET/" /etc/blocktogether/config.json

mysqladmin -u root password "$DB_ROOT_PASS"
./bin/setup.sh

npm install

./node_modules/.bin/sequelize --config /etc/blocktogether/sequelize.json db:migrate

./run-dev.sh > bt.log 2>&1 &

until curl localhost:3000; do echo "Waiting for service..."; sleep 1; done
