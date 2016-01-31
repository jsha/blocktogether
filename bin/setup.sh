#!/bin/bash -ex

# Set up a production instance of Block Together. Assumes no existing root MySQL
# password (as is true of a freshly installed mysql-server).
# Safe to run multiple times.
#
APPUSER=${APPUSER:-vagrant}
DB_ROOT_PASS=${DB_ROOT_PASS:-$(openssl rand -hex 20)}
ROOT_MY_CONF=/root/.my.cnf
if [ ! -f ${ROOT_MY_CONF} ] ; then
  debconf-set-selections <<<"mariadb-server-5.5 mysql-server/root_password password $DB_ROOT_PASS"
  debconf-set-selections <<<"mariadb-server-5.5 mysql-server/root_password_again password $DB_ROOT_PASS"
  cat > ${ROOT_MY_CONF} <<EOCONF
[mysql]
password=$DB_ROOT_PASS
EOCONF
  chmod 0600 ${ROOT_MY_CONF}
fi

# Set postfix configs before installing mailutils so it doesn't fail in
# non-interactive install.
debconf-set-selections <<<"postfix postfix/mailname string $HOSTNAME"
debconf-set-selections <<<"postfix postfix/main_mailer_type string 'Internet Site'"
export DEBIAN_FRONTEND=noninteractive

DB_PASS=$(openssl rand -hex 20)

# Set up the nodesource Node repo to get the latest.
curl -s https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add -
sudo tee /etc/apt/sources.list.d/nodesource.list <<EOAPT
deb https://deb.nodesource.com/node_5.x trusty main
deb-src https://deb.nodesource.com/node_5.x trusty main
EOAPT

apt-get update
apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" \
  mariadb-client-5.5 mariadb-server-5.5 git nginx gnupg curl build-essential \
  nodejs mailutils postfix

ln -sf nodejs /usr/bin/node

SEQUELIZE_CONFIG=/etc/blocktogether/sequelize.json
if grep -q __PASSWORD__ $SEQUELIZE_CONFIG ; then
  sed -i s/__PASSWORD__/$DB_PASS/g $SEQUELIZE_CONFIG
  mysql --defaults-file=$ROOT_MY_CONF <<EOSQL
    CREATE DATABASE IF NOT EXISTS blocktogether;
    GRANT ALL PRIVILEGES ON blocktogether.* TO
      'blocktogether'@'127.0.0.1' IDENTIFIED BY "${DB_PASS}";
    GRANT ALL PRIVILEGES ON blocktogether.* TO
      'blocktogether'@'localhost' IDENTIFIED BY "${DB_PASS}";
    GRANT INSERT, SELECT, UPDATE, DELETE ON blocktogether.* TO
      'blocktogether'@'172.31.%' IDENTIFIED BY "${DB_PASS}";
    GRANT REPLICATION SLAVE ON *.* TO 'replication'@'%' IDENTIFIED BY "${DB_PASS}";
EOSQL
  APP_MY_CONF=/home/${APPUSER}/.my.cnf
  cat > ${APP_MY_CONF} <<EOCONF
[mysql]
password=$DB_PASS
user=blocktogether
database=blocktogether
EOCONF
  chmod 0600 ${APP_MY_CONF}
  chown ${APPUSER} ${APP_MY_CONF}
fi

COOKIE_SECRET=$(openssl rand -hex 20)
sed -i s/__COOKIE_SECRET__/$COOKIE_SECRET/g /etc/blocktogether/config.json

CONF=/etc/blocktogether
KEY=${CONF}/rpc.key
if [ ! -f ${KEY} ] ; then
  openssl req -new -newkey rsa:2048 -nodes -days 10000 -x509 \
    -keyout ${KEY} -out ${CONF}/rpc.crt \
    -subj /CN=blocktogether-rpc 2>/dev/null
  chmod 0600 ${KEY}
  chown ${APPUSER}.${APPUSER} ${KEY} ${CONF}/rpc.crt
fi

if ! crontab -u ${APPUSER} -l >/dev/null; then
  crontab -u ${APPUSER} - <<-EOCRON
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
    MAILTO=ubuntu
    23 10 * * * bash /data/blocktogether/current/util/cron.sh
EOCRON
fi

rm -f /etc/nginx/sites-enabled/default

mkdir -p /data/blocktogether/shared/log/
