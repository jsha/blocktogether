#!/bin/bash -e

NODE_VERSION="v0.10.35" # Latest stable

echo "*********************** Downloading nvm ***********************"
curl https://raw.githubusercontent.com/creationix/nvm/v0.16.1/install.sh | sh
source ~/.nvm/nvm.sh
echo "*********************** Downloading node v0.10.35 ***********************"
nvm install $NODE_VERSION
nvm alias default $NODE_VERSION

echo "*********************** Installing blocktogether node modules ***********************"
cd /vagrant/
npm install

echo "*********************** Migrating ***********************"
./node_modules/sequelize/bin/sequelize --config /etc/blocktogether/sequelize.json -m
