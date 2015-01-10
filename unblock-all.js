'use strict';
(function() {
/**
 * Script to block a list of screen names using credentials for a given user id
 */
var twitterAPI = require('node-twitter-api'),
    Q = require('q'),
    fs = require('fs'),
    util = require('./util'),
    setup = require('./setup');

var twitter = setup.twitter,
    logger = setup.logger,
    BtUser = setup.BtUser,
    TwitterUser = setup.TwitterUser,
    BlockBatch = setup.BlockBatch,
    Block = setup.Block;

if (process.argv.length < 3) {
  logger.fatal('Usage: js many-blocks.js screen_name');
  process.exit();
}

function unblock5000(user) {
  return Q.ninvoke(twitter, 'blocks', 'ids', {
    stringify_ids: true,
  }, user.access_token,
  user.access_token_secret
  ).then(function(results) {
    var ids = results[0].ids;
    logger.info('Got', ids.length, 'blocks');
    if (ids.length === 0) {
      return Q.resolve(false /* moreBlocks */);
    } else {
      return util.slowForEach(ids, 120, function(uid) {
        logger.info('Unblocking', uid);
        return Q.ninvoke(twitter, 'blocks', 'destroy', {
          user_id: uid,
          skip_status: 1
        }, user.access_token, user.access_token_secret
        ).catch(function(err) {
          logger.error(err);
        });
      }).thenResolve(!!results[0].nextCursor);
    }
  });
}

BtUser
  .find({
    where: {
      screen_name: process.argv[2]
    }
  }).then(function(user) {
    if (!user) {
      logger.fatal('No user', process.argv[2]);
      process.exit(1);
    }
    function unblockAll() {
      return unblock5000(user).then(function(moreBlocks) {
        if (moreBlocks) return unblockAll();
      });
    }
    return unblockAll().then(function() {
      logger.info('Done.');
    })
  }).catch(function(err) {
    logger.error(err);
  });
})();
