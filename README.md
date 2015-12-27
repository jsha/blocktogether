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

You're now ready to run Block Together locally. :D SSH into the Vagrant box and
start the daemons:

    vagrant ssh
    cd /vagrant && ./run-dev.sh

You can now access your local version of Block Together in a browser
at http://localhost:3000.

**Note:** It's highly recommended you create a few test accounts
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
