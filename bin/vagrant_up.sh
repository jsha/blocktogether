# #!/bin/bash
# Bootstraps the Block Together dev environment on a fresh Vagrant box.
source /vagrant/bin/init_config.sh
sudo /vagrant/bin/setup.sh

sudo chown -R "$USER" /data/blocktogether

cd /vagrant
npm install
./node_modules/.bin/sequelize --config /etc/blocktogether/sequelize.json db:migrate

echo
echo "Vagrant bootstrap complete. Refer to the README for more setup instructions."
echo "Thanks for developing blocktogether <3"
echo
