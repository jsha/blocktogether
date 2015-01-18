# #!/bin/bash

# Bootstraps the BlockTogether dev environment from a fresh Vagrant box.
# Note that this will override any pre-existing config state (Twitter credentials, etc.)
# and is NOT idempotent. (Check out setup.sh for that.)
#
source /vagrant/bin/init_config.sh
source /vagrant/bin/setup.sh

sudo chown -R vagrant /etc/blocktogether
sudo chown -R vagrant /data/blocktogether

curl https://deb.nodesource.com/setup | sudo bash -
sudo apt-get install -y nodejs

cd /vagrant && npm install
./node_modules/sequelize/bin/sequelize --config /etc/blocktogether/sequelize.json -m

echo
echo "Vagrant bootstrap complete. Refer to the README for more setup instructions."
echo "Thanks for developing blocktogether <3"
echo
