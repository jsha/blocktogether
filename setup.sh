#!/bin/bash
#
# Set up a production instance of Block Together
#
sudo apt-get update
sudo apt-get install mysql-common mysql-server mysql-client-core-5.5 nodejs nginx
npm install
echo "Enter MySQL root password."
mysql -u root -p <<<EOSQL
  CREATE DATABASE blocktogether;
  GRANT ALL ON blocktogether.* to 'blocktogether'@'localhost' IDENTIFIED BY XXX;
EOSQL
