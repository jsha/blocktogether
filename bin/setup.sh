#!/bin/bash -e

# Set up a production instance of Block Together. Assumes no existing root MySQL
# password (as is true of a freshly installed mysql-server).
# Safe to run multiple times.
#
DB_ROOT_PASS=${DB_ROOT_PASS:-$(openssl rand -hex 20)}
if [ ! -f /usr/sbin/mysqld ] ; then
  echo "*********************** IMPORTANT ***********************"
  echo "*********************** IMPORTANT ***********************"
  echo "This will be your MySQL server root password, write it down:"
  echo
  echo $DB_ROOT_PASS
  echo
  echo "*********************** IMPORTANT ***********************"
  echo "*********************** IMPORTANT ***********************"
  sudo debconf-set-selections <<<"mysql-server mysql-server/root_password password $DB_ROOT_PASS"
  sudo debconf-set-selections <<<"mysql-server mysql-server/root_password_again password $DB_ROOT_PASS"
fi

DB_PASS=password #$(openssl rand -hex 20)

sudo apt-get update
sudo apt-get install -y mysql-client mysql-server git nginx gnupg curl build-essential nodejs npm mailutils
sudo ln -sf nodejs /usr/bin/node

SEQUELIZE_CONFIG=/etc/blocktogether/sequelize.json
if grep -q __PASSWORD__ $SEQUELIZE_CONFIG ; then
  sed -i s/__PASSWORD__/$DB_PASS/g $SEQUELIZE_CONFIG
  mysql -u root --password="$DB_ROOT_PASS" <<EOSQL
    CREATE DATABASE IF NOT EXISTS blocktogether;
    GRANT ALL PRIVILEGES ON blocktogether.* TO
      'blocktogether'@'127.0.0.1' IDENTIFIED BY "${DB_PASS}";
    GRANT ALL PRIVILEGES ON blocktogether.* TO
      'blocktogether'@'localhost' IDENTIFIED BY "${DB_PASS}";
    GRANT INSERT, SELECT, UPDATE, DELETE ON blocktogether.* TO
      'blocktogether'@'172.31.%' IDENTIFIED BY "${DB_PASS}";
EOSQL
fi

COOKIE_SECRET=$(openssl rand -hex 20)
sed -i s/__COOKIE_SECRET__/$COOKIE_SECRET/g /etc/blocktogether/config.json

CONF=/etc/blocktogether
if [ ! -f ${CONF}/rpc.key ] ; then
  openssl req -new -newkey rsa:2048 -nodes -days 10000 -x509 \
    -keyout ${CONF}/rpc.key -out ${CONF}/rpc.crt \
    -subj /CN=blocktogether-rpc
  chmod 0600 ${CONF}/rpc.key
fi

if ! crontab -l >/dev/null; then
  crontab - <<-EOCRON
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games
    MAILTO=ubuntu
    23 10 * * * bash /data/blocktogether/current/util/cron.sh
EOCRON
fi

sudo mkdir -p /data/blocktogether/shared/log/

# NOTE FOR DEPLOYING TO PRODUCTION:
# You will still have to install nodejs.
# https://github.com/joyent/node/wiki/installing-node.js-via-package-manager#debian-and-ubuntu-based-linux-distributions
