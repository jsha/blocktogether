# #!/bin/bash

# Bootstraps the Block Together dev environment from a fresh Vagrant box.
# Note that this will override any pre-existing config state (Twitter credentials, etc.)
# and is NOT idempotent. (Check out setup.sh for that.)
#
source /vagrant/bin/init_config.sh
source /vagrant/bin/setup.sh

sudo chown -R "$USER" /data/blocktogether

cd /vagrant && npm install
./node_modules/.bin/sequelize --config /etc/blocktogether/sequelize.json db:migrate

echo
echo "Vagrant bootstrap complete. Refer to the README for more setup instructions."
echo "Thanks for developing blocktogether <3"
echo
