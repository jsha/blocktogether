'use strict';
(function() {
/**
 * Similar to twurl (https://github.com/twitter/twurl), fetch a given Twitter
 * API URL using appropriate credentials. In this case, credentials are pulled
 * from the DB based on a username, and the response is output to stdout.
 */
var twitterAPI = require('node-twitter-api'),
    setup = require('./setup');

var twitter = setup.twitter,
    BtUser = setup.BtUser;

if (process.argv.length < 4) {
  process.stderr.write('Usage: js screen_name /api/path');
  process.exit(1);
}

BtUser
  .find({
    where: {
      screen_name: process.argv[2]
    }
  }).then(function(user) {
    if (!user) {
      process.stderr.write('No user', process.argv[2]);
      process.exit(1);
    }
    twitter.oa.get("https://api.twitter.com/1.1" + process.argv[3],
      user.access_token, user.access_token_secret,
      function(err, data, response) {
        if (err) {
          process.stderr.write(err);
        } else {
          process.stdout.write(JSON.stringify(JSON.parse(data), null, '\t'));
          process.stdout.write('\n');
        }
      });
  }).catch(function(err) {
    process.stderr.write(err);
  });
})();
