# Block Together

An API app intended to help cope with harassers and abusers on Twitter.

See more details at https://blocktogether.org.

# Developer Setup Instructions

First, create an app on Twitter for your local version of blocktogether:

  1. Head to https://apps.twitter.com/ and click "Create New App."

  2. Fill out form & click "Create your Twitter application".
     Important: fill in some arbitrary URL for 'Callback URL.' It will be overridden
     by the app, but if it's empty you won't be able to log in.
     The description and website don't matter; You'll only be using this for testing.

  3. Under "Application Settings" > "Access level", click "modify app permissions"
     and select "Read and Write" access. The write permission is necessary to apply
     blocks, unblocks, and mutes. You may need to add a phone number to your
     account in order to get read/write permission.

  4. After you've set the read-write permissions, click the "Keys and Access Tokens"
     tab. Note that changing your app's permissions will regenerate these keys.

  5. Copy config/development.json to ~/.btconfig.json, and edit the
     "consumerKey" and "consumerSecret" fields to match the "Consumer Key (API
     Key)" and "Consumer Secret (API Secret)" fields from the "Keys and Access
     Tokens" page.

Next, make sure that you have [Vagrant](https://www.vagrantup.com/) installed.
From the blocktogether directory, run:

    vagrant up
    vagrant ssh -c /vagrant/run-dev.sh

You can now access your local version of Block Together in a browser
at http://localhost:3000.

**Note:** It's highly recommended you create a few test accounts
on Twitter in order to be able to exercise the sharing functionality of Block
Together, and so that you don't create or delete blocks on your main account
unintentionally.

## Developing locally

It’s recommended that you develop in a Vagrant instance; but if you
want to develop on your local machine the steps are these:

### macOS

1. `brew install mysql node` (MariaDB can be used in place of MySQL)
2. `brew services start mysql`
3. In MySQL, create a ’blocktogether’ database, a
   `'blocktogether'@'localhost'` user, and grant the latter privileges
   on the former (see `bin/setup.sh`).
4. `sed -i 's/__PASSWORD__//' config/sequelize.json` (unless you set a
   database password; then replace `__PASSWORD__` with that)
5. `openssl req -new -newkey rsa:2048 -nodes -days 10000 -x509 -keyout config/rpc.key -out config/rpc.crt -subj /CN=blocktogether-rpc`
6. Make a test Twitter account and an app with read/write permissions
   ([follow the instructions above](#developer-setup-instructions)),
   and add its keys to `config/development.json`
7. `cp config/development.json config/config.json`
8. `npm i`
9. `./node_modules/.bin/sequelize --config config/sequelize.json db:migrate`
10. `export BT_CONFIG_DIR=$(pwd)/config`
11. `./run-dev.sh`

# License

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>
