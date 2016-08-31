'use strict';
(function() {
/**
 * Unblock, follow, and generally set up users for testing.
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
      }).thenResolve(true);
    }
  });
}

function getUser(screen_name) {
  return BtUser
    .find({
      where: {
        screen_name: screen_name
      }
    });
}

Q.all(['twestact3', 'twestact4', 'twestact5', 'twestact6', 'twestact8', 'twestact9'].map(screen_name => {
  getUser(screen_name).then(user => {
    if (!user) {
      logger.fatal('No user', screen_name);
      process.exit(1);
    }
    function unblockAll() {
      return unblock5000(user).then(function(moreBlocks) {
        if (moreBlocks) return unblockAll();
      });
    }
    return unblockAll();
  });
})).then(_ => getUser('twestact3')
).then(twestact3 => {
  return [Q.ninvoke(twitter, 'friendships', 'create', {
    screen_name: 'twestact5',
   }, twestact3.access_token, twestact3.access_token_secret),
   Q.ninvoke(twitter, 'blocks', 'create', {
    screen_name: 'twestact6',
   }, twestact3.access_token, twestact3.access_token_secret)];
}).spread(_ => {
  logger.info('Done. Now:');
  logger.info('mysql -e "delete from BlockBatches;"');
  logger.info('mysql -e "delete from Actions;"');
}).catch(function(err) {
  logger.error(err);
});

})();
