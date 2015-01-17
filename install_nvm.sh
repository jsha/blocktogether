#!/bin/bash -e

echo "*********************** Downloading nvm ***********************"
curl https://raw.githubusercontent.com/creationix/nvm/v0.16.1/install.sh | sh
source ~/.nvm/nvm.sh
echo "*********************** Downloading node v0.10.35 ***********************"
nvm install v0.10.35
nvm alias default v0.10.35

echo "*********************** Installing node modules ***********************"
cd /vagrant/
npm install
echo "*********************** Migrating... ***********************"
./node_modules/sequelize/bin/sequelize --config /etc/blocktogether/sequelize.json -m
