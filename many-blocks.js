'use strict';
(function() {
/**
 * Script to block a list of screen names using credentials for a given user id
 */
var twitterAPI = require('node-twitter-api'),
    fs = require('fs'),
    util = require('./util'),
    setup = require('./setup');

var twitter = setup.twitter,
    logger = setup.logger,
    BtUser = setup.BtUser,
    TwitterUser = setup.TwitterUser,
    BlockBatch = setup.BlockBatch,
    Block = setup.Block;

if (process.argv.length < 4) {
  logger.fatal('Usage: js many-blocks.js UID FILE_SCREEN_NAMES');
  process.exit();
}

BtUser
  .find(process.argv[2])
  .error(function(err) {
    logger.error(err);
  }).success(function(user) {
    var filename = process.argv[3];

    var accessToken = user.access_token;
    var accessTokenSecret = user.access_token_secret;
    var targets = fs.readFileSync(filename)
      .toString().replace(/\n$/, '').split('\n');

    util.slowForEach(targets, 120, function(target) {
        logger.info('Blocking ' + target);
        twitter.blocks('create', {
          user_id: target,
          skip_status: 1
        }, accessToken, accessTokenSecret,
        function(err, results) {
          if (err) {
            logger.error('Error blocking: %j', err);
          } else {
            logger.info('Blocked ' + target);
          }
      });
    });
  });
})();
