/**
 * Script to block a list of screen names using credentials for a given user id
 */
var twitterAPI = require('node-twitter-api'),
    fs = require('fs'),
    setup = require('./setup');

var twitter = setup.twitter,
    BtUser = setup.BtUser,
    TwitterUser = setup.TwitterUser,
    BlockBatch = setup.BlockBatch,
    Block = setup.Block;

if (process.argv.length < 4) {
  console.log("Usage: js many-blocks.js UID FILE_SCREEN_NAMES");
  process.exit();
}

BtUser
  .find(process.argv[2])
  .error(function(err) {
    console.log(err);
  }).success(function(user) {
    var filename = process.argv[3];

    var accessToken = user.access_token;
    var accessTokenSecret = user.access_token_secret;
    console.log(accessToken, accessTokenSecret);
    var targets = fs.readFileSync(filename)
      .toString().replace(/\n$/, '').split("\n");

    var blockAndNext = function(targets) {
      if (targets.length > 0) {
        var targetScreenName = targets.pop();
        console.log("Blocking " + targetScreenName);
        twitter.blocks("create", {
          screen_name: targetScreenName,
          skip_status: 1
        }, accessToken, accessTokenSecret,
        function(err, results) {
          if (!!err) {
            console.log("Error blocking: %j", err);
          } else {
            console.log("Blocked " + targetScreenName);
          }
          // In 100 ms, run this again for the next item.
          setTimeout(blockAndNext.bind(null, targets), 100);
        });
      }
    }
    blockAndNext(targets);
  });
