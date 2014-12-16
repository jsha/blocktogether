# Block Together

An API app intended to help cope with harassers and abusers on Twitter.

See more details at https://blocktogether.org.

# Developer Setup Instructions

First make a config directory and copy the config files into it:

    sudo mkdir /etc/blocktogether
    sudo chown YOUR_USERNAME /etc/blocktogether
    cp -r config/* /etc/blocktogether/
    mv /etc/blocktogether/development.json /etc/blocktogether/config.json

You will need Node and MySQL. If you are on Ubuntu or Debian, the
easiest way to get these is to run `bash setup.sh`, which will run an apt-get
install for the packages you need (plus a few extras mainly used by the prod
instance, like gnupg). Setup.sh will also set a MySQL root password if it's your
first time installing MySQL - write it down or store it in your password
manager. If you already have a MySQL root password set, run:

    DB_ROOT_PASS=YOUR_PASSWORD
    bash setup.sh

Next, run `npm install` to get the necessary NPM packages, and create the
necessary database tables with:

    ./node_modules/sequelize/bin/sequelize --config /etc/blocktogether/sequelize.json -m

Now, create an API app at https://apps.twitter.com/app/new. The description and
website don't matter; You'll only be using this for testing. However, it is
important that you don't leave the 'Callback URL' blank or you won't be able to
log in. Fill in any arbitrary URL here - the app will override it at login time.
After you've created the app, make sure it is set to have read/write permission.
The write permission is necessary to apply blocks, unblocks, and mutes. You may
need to add a phone number to your account in order to get read/write
permission. After you've set read-write permission, the consumerKey and
consumerSecret listed on apps.twitter.com will be different. Copy the new
consumerKey and consumerSecret into /etc/blocktogether/config.json in the
appropriate fields.

You're now ready to start the web frontend:

    bash ./run.sh
    firefox http://localhost:3000/

Log in for the first time using the 'Log in' button, not the 'Sign up' button.
After you've authorized your app, you should be able to connect to the database
using the credentials installed in /etc/blocktogether/config.json:

    mysql -u blocktogether --password=PASSWORD -D blocktogether

Extract the `access_token` and `access_token_secret` for your user:

    select * from BtUsers \G

Put these in /etc/blocktogether/config.json, using the same capitalization as
the existing fields. Also change `userToFollow` to your Twitter handle.

Now you can start the support daemons:

     js update-users.js
     js update-blocks.js
     js actions.js
     js stream.js

These perform the background work that the web frontend doesn't do. You can now
start developing! Note: It's highly recommended you create a few test accounts
on Twitter in order to be able to exercise the sharing functionality of Block
Together, and so that you don't create or delete blocks on your main account
unintentionally.

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
