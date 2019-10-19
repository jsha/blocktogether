#!/bin/bash
set -ex
# Bootstraps the Block Together dev environment on a fresh Vagrant box.
source /vagrant/bin/init_config.sh
sudo /vagrant/bin/setup.sh

sudo rsync -lr /vagrant/config/etc/ /etc/
sudo mkdir -p /data/
sudo mv /var/lib/mysql /data/mysql
sudo mkdir /data/mysql/tmp -p
sudo chown mysql.mysql /data/mysql/tmp
sudo mkdir /var/lib/mysql
sudo chown mysql.mysql /var/lib/mysql
### Edit /etc/mysql/mariadb.conf.d/50-server.cnf to remove datadir line so
### blocktogether override can take precedence.
sudo sed -i /datadir/d /etc/mysql/mariadb.conf.d/50-server.cnf

sudo service mysql restart

sudo chown -R "$USER" /data/blocktogether

cd /vagrant
npm install
./node_modules/.bin/sequelize --config /etc/blocktogether/sequelize.json db:migrate

echo
echo "Vagrant bootstrap complete. Refer to the README for more setup instructions."
echo "Thanks for developing blocktogether <3"
echo
