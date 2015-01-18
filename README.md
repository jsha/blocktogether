# Block Together

An API app intended to help cope with harassers and abusers on Twitter.

See more details at https://blocktogether.org.

# Developer Setup Instructions

First, make sure that you have [Vagrant](https://www.vagrantup.com/) installed.
Then, from the blocktogether directory, run:

    vagrant up

Second, create an app on Twitter for your local version of blocktogether:

  1. Head to https://apps.twitter.com/ and click "Create New App"
  2. Fill out form & click "Create your Twitter application". (The description and
     website don't matter; You'll only be using this for testing. However, it is
     important that you don't leave the 'Callback URL' blank or you won't be able to
     log in. Fill in any arbitrary URL here - the app will override it at login time.

  3. Under "Application Settings" > "Access level", click "modify app permissions"
     and select "Read and Write" access. The write permission is necessary to apply
     blocks, unblocks, and mutes. (You may need to add a phone number to your
     account in order to get read/write permission.)

  4. After you've set the read-write permissions, click the "Keys and Access Tokens"
     tab. (Note that changing your app's permissions will regenerate these keys.)


Now, we'll want to save our Twitter credentials to the configfile so BlockTogether
can access Twitter's API:

  1. From the `blocktogether` directory, run `vagrant ssh`
  2. Open the config file for editing: `sudo vim /etc/blocktogether/config.json`
     or with your editor of choice (though you might have to apt-get it)
  3. Replace the placeholder `consumerKey` and `consumerSecret` fields with your
     your new credentials (found under your dev app on https://apps.twitter.com)

You're now ready to run BlockTogether locally. :D Start the by first SSH'ing
into the Vagrant box. From the root `blocktogether` directory:

    vagrant ssh

And then from the Vagrant box:

    cd /vagrant && ./run.sh

You should now be able to access your local version of blocktogether in a browser
at http://localhost:3000.

Log in for the first time using the 'Log in' button (nope, not the 'Sign up' button).
After you've authorized your app, you should be able to connect to the database
using the credentials installed in /etc/blocktogether/config.json:

    mysql -u blocktogether --password=PASSWORD -D blocktogether

Extract the `access_token` and `access_token_secret` for your user:

    select * from BtUsers \G

Put these in /etc/blocktogether/config.json, using the same capitalization as
the existing fields. Also change `userToFollow` to your Twitter handle.

Now you can start the server & the support daemons. (The daemons perform the
background work that the web frontend doesn't do.)

     vagrant ssh
     cd /vagrant && ./run-dev.sh

You can now start developing!

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
