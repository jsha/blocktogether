'use strict';
(function() {
var twitterAPI = require('node-twitter-api'),
    fs = require('fs'),
    timeago = require('timeago'),
    setup = require('./setup'),
    updateUsers = require('./update-users');

var twitter = setup.twitter,
    logger = setup.logger,
    BtUser = setup.BtUser,
    TwitterUser = setup.TwitterUser,
    BlockBatch = setup.BlockBatch,
    Block = setup.Block;

var ONE_DAY_IN_MILLIS = 86400 * 1000;

/**
 * Find a user who hasn't had their blocks updated recently and update them.
 */
function findAndUpdateBlocks() {
  BtUser
    .find({
      order: 'BtUsers.updatedAt ASC'
    }).error(function(err) {
      logger.error(err);
    }).success(function(user) {
      // We structure this as a nested fetch rather than using sequelize's include
      // functionality, because ordering inside nested selects doesn't appear to
      // work (https://github.com/sequelize/sequelize/issues/2121).
      user.getBlockBatches({
        // Get the latest BlockBatch for the user and skip if < 1 day old.
        // Note: We count even incomplete BlockBatches towards being 'recently
        // updated'. This prevents the setInterval from repeatedly initiating
        // block fetches for the same user, because the first block fetch will
        // create an up-to-date BlockBatch immediately (even though it will take
        // some time to fill it and mark it complete).
        limit: 1,
        order: 'updatedAt desc'
      }).error(function(err) {
        logger.err(err);
      }).success(function(batches) {
        // HACK: mark the user as updated. This allows us to iterate through the
        // BtUsers table looking for users that haven't had their blocks updated
        // recently, instead of having to iterate on a join of BlockBatches with
        // BtUsers.
        user.updatedAt = new Date();
        user.save().error(function(err) {
          logger.error(err);
        });
        if (batches && batches.length > 0) {
          logger.debug('User', user.uid, 'has updated blocks from',
            timeago(new Date(batches[0].createdAt)));
          if ((new Date() - new Date(batches[0].createdAt)) > ONE_DAY_IN_MILLIS) {
            updateBlocks(user);
          }
        } else {
          logger.warn('User', user.uid, 'has no updated blocks ever.');
        }
      });
    });
}

/**
 * For a given BtUser, fetch all current blocks and store in DB.
 *
 * @param {BtUser} user The user whose blocks we want to fetch.
 */
function updateBlocks(user) {
  BlockBatch.create({
    source_uid: user.uid
  }).error(function(err) {
    logger.error(err);
  }).success(function(blockBatch) {
    fetchAndStoreBlocks(blockBatch, user.access_token, user.access_token_secret);
  });
}

function fetchAndStoreBlocks(blockBatch, accessToken, accessTokenSecret, cursor) {
  logger.info('Fetching blocks for', blockBatch.source_uid);
  // A function that can simply be called again to run this once more with an
  // update cursor.
  var getMore = fetchAndStoreBlocks.bind(null,
    blockBatch, accessToken, accessTokenSecret);
  var currentCursor = cursor || -1;
  twitter.blocks('ids', {
      // Stringify ids is very important, or we'll get back numeric ids that
      // will get subtly mangled by JS.
      stringify_ids: true,
      cursor: currentCursor
    },
    accessToken, accessTokenSecret,
    handleIds.bind(null, blockBatch, currentCursor, getMore));
}

function handleIds(blockBatch, currentCursor, getMore, err, results) {
  if (err) {
    if (err.statusCode === 429) {
      logger.warn('Rate limited. Trying again in 15 minutes.');
      setTimeout(function() {
        getMore(currentCursor);
      }, 15 * 60 * 1000);
    } else {
      logger.error(err);
    }
    return;
  }

  // Update the current cursor stored with the blockBatch. Not currently used,
  // but may be useful to resume fetching blocks across restarts of this script.
  blockBatch.currentCursor = currentCursor;
  blockBatch.save();

  // First, add any new uids to the TwitterUser table if they aren't already
  // there (note ignoreDuplicates so we don't overwrite fleshed-out users).
  // Note: even though the field name is 'ids', these are actually stringified
  // ids because we specified that in the request.
  var usersToCreate = results.ids.map(function(id) {
    return {uid: id};
  });
  TwitterUser.bulkCreate(usersToCreate, { ignoreDuplicates: true });

  // Now we create block entries for all the blocked ids. Note: setting
  // BlockBatchId explicitly here doesn't show up in the documentation,
  // but it seems to work.
  var blocksToCreate = results.ids.map(function(id) {
    return {
      sink_uid: id,
      BlockBatchId: blockBatch.id
    };
  });
  Block
    .bulkCreate(blocksToCreate)
    .error(function(err) {
      logger.error(err);
    }).success(function(blocks) {
      updateUsers.findAndUpdateUsers();
    });

  // Check whether we're done or next to grab the items at the next cursor.
  if (results.next_cursor_str === '0') {
    logger.info('Finished fetching blocks for user', blockBatch.source_uid);
    // Mark the BlockBatch as complete and save that bit.
    blockBatch.complete = true;
    blockBatch.save().error(function(err) {
      logger.error(err);
    });
  } else {
    logger.debug('Cursoring ', results.next_cursor_str);
    getMore(results.next_cursor_str);
  }
}

module.exports = {
  updateBlocks: updateBlocks
};

if (require.main === module) {
  findAndUpdateBlocks();
  setInterval(findAndUpdateBlocks, 1000);
}
})();
