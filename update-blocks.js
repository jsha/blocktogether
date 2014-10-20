'use strict';
(function() {
var twitterAPI = require('node-twitter-api'),
    fs = require('fs'),
    /** @type{Function|null} */ timeago = require('timeago'),
    _ = require('sequelize').Utils._,
    setup = require('./setup'),
    updateUsers = require('./update-users');

var twitter = setup.twitter,
    logger = setup.logger,
    BtUser = setup.BtUser,
    TwitterUser = setup.TwitterUser,
    Action = setup.Action,
    BlockBatch = setup.BlockBatch,
    Block = setup.Block;

var ONE_DAY_IN_MILLIS = 86400 * 1000;

/**
 * Find a user who hasn't had their blocks updated recently and update them.
 */
function findAndUpdateBlocks() {
  BtUser
    .find({
      where: ["(updatedAt < DATE_SUB(NOW(), INTERVAL 1 DAY) OR updatedAt IS NULL) AND deactivatedAt IS NULL"],
      order: 'BtUsers.updatedAt ASC'
    }).error(function(err) {
      logger.error(err);
    }).success(function(user) {
      if (!user) {
        return;
      }
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
          var batch = batches[0];
          logger.debug('User', user.uid, 'has updated blocks from',
            timeago(new Date(batch.createdAt)));
          if ((new Date() - new Date(batch.createdAt)) > ONE_DAY_IN_MILLIS) {
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
    fetchAndStoreBlocks(user, blockBatch);
  });
}

/**
 * For a given BtUser, fetch all current blocks and store in DB.
 *
 * @param {BtUser} user The user whose blocks we want to fetch.
 * @param {BlockBatch|null} blockBatch The current block batch in which we will
 *   store the blocks. Null for the first fetch, set if cursoring is needed.
 * @param {string|null} cursor When cursoring, the current cursor for the
 *   Twitter API.
 */
function fetchAndStoreBlocks(user, blockBatch, cursor) {
  logger.info('Fetching blocks for', blockBatch.source_uid);
  // A function that can simply be called again to run this once more with an
  // updated cursor.
  var getMore = fetchAndStoreBlocks.bind(null,
    user, blockBatch);
  var currentCursor = cursor || '-1';
  twitter.blocks('ids', {
      // Stringify ids is very important, or we'll get back numeric ids that
      // will get subtly mangled by JS.
      stringify_ids: true,
      cursor: currentCursor
    },
    user.access_token, user.access_token_secret,
    handleIds.bind(null, blockBatch, currentCursor, getMore));
}

/**
 * Given results from Twitter, store as appropriate.
 * @param {BlockBatch|null} blockBatch BlockBatch to add blocks to. Null for the
 *   first batch, set if cursoring is needed.
 * @param {string} currentCursor
 * @param {Function} getMore
 * @param {TwitterError} err
 * @param {Object} results
 */
function handleIds(blockBatch, currentCursor, getMore, err, results) {
  if (err) {
    if (err.statusCode === 429) {
      logger.info('Rate limited. Trying again in 15 minutes.');
      setTimeout(function() {
        getMore(currentCursor);
      }, 15 * 60 * 1000);
    } else {
      logger.error('Error /blocks/ids', err.statusCode, err.data);
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
      // Check whether we're done or need to grab the items at the next cursor.
      if (results.next_cursor_str === '0') {
        finalizeBlockBatch(blockBatch);
      } else {
        logger.debug('Cursoring ', results.next_cursor_str);
        getMore(results.next_cursor_str);
      }
    });
}

function finalizeBlockBatch(blockBatch) {
  logger.info('Finished fetching blocks for user', blockBatch.source_uid);
  // Mark the BlockBatch as complete and save that bit.
  blockBatch.complete = true;
  Block.count({
    where: {
      BlockBatchId: blockBatch.id
    }
  }).error(function(err) {
    logger.error(err);
  }).success(function(count) {
    blockBatch.size = count;
    blockBatch.save().error(function(err) {
      logger.error(err);
    }).success(function(blockBatch) {
      diffBatchWithPrevious(blockBatch);
      // Prune older BlockBatches for this user from the DB.
      destroyOldBlocks(blockBatch.source_uid);
    });
  });
}

/**
 * Compare a BlockBatch with the immediately previous completed BlockBatch
 * for the same uid. Generate Actions with cause = external from the result.
 * @param {BlockBatch} currentBatch The batch to compare to its previous batch.
 */
function diffBatchWithPrevious(currentBatch) {
  var source_uid = currentBatch.source_uid;
  BlockBatch.findAll({
    where: {
      source_uid: source_uid,
      id: { lte: currentBatch.id }
    },
    order: 'id DESC',
    limit: 2
  }).error(function(err) {
    logger.error(err);
  }).success(function(batches) {
    if (batches && batches.length === 2) {
      var currentBatch = batches[0];
      var oldBatch = batches[1];
      var currentBlocks = [];
      var oldBlocks = [];
      currentBatch.getBlocks().then(function(blocks) {
        currentBlocks = blocks;
        return oldBatch.getBlocks();
      }).then(function(blocks) {
        oldBlocks = blocks;
        logger.debug('Current batch size', currentBlocks.length,
          'old', oldBlocks.length, 'ids', batches[0].id, batches[1].id);
        var currentBlockIds = _.pluck(currentBlocks, 'sink_uid');
        var oldBlockIds = _.pluck(oldBlocks, 'sink_uid');
        var addedBlockIds = _.difference(currentBlockIds, oldBlockIds);
        var removedBlockIds = _.difference(oldBlockIds, currentBlockIds);
        logger.debug('Block diff for', source_uid,
          'added:', addedBlockIds, 'removed:', removedBlockIds);
        addedBlockIds.forEach(function(sink_uid) {
          recordAction(source_uid, sink_uid, Action.BLOCK);
        });
        recordUnblocksUnlessDeactivated(source_uid, removedBlockIds);
      });
    } else {
      logger.warn('Insufficient block batches to diff.');
    }
  });
}

/**
 * For a list of sink_uids that disappeared from a user's /blocks/ids, check them
 * all for deactivation. If they were deactivated, that is probably why they
 * disappeared from /blocks/ids, rather than an unblock.
 * If they were not deactivated, go ahead and record an unblock in the Actions
 * table.
 *
 * Note: We don't do this check for blocks, which leads to a bit of asymmetry:
 * if a user deactivates and reactivates, there will be an external block entry
 * in Actions but no corresponding external unblock. This is fine. The main
 * reason we care about not recording unblocks for users that were really just
 * deactivated is to avoid triggering unblock/reblock waves for subscribers when
 * users frequently deactivate / reactivate. Also, part of the product spec for
 * shared block lists is that blocked users remain on shared lists even if they
 * deactivate.
 *
 * @param {string} source_uid Uid of user doing the unblocking.
 * @param {Array.<string>} sink_uids List of uids that disappeared from a user's
 *   /blocks/ids.
 */
function recordUnblocksUnlessDeactivated(source_uid, sink_uids) {
  while (sink_uids.length > 0) {
    // Pop 100 uids off of the list.
    var uidsToQuery = sink_uids.splice(0, 100);
    twitter.users('lookup', {
        skip_status: 1,
        user_id: uidsToQuery.join(',')
      },
      setup.config.defaultAccessToken, setup.config.defaultAccessTokenSecret,
      function(err, response) {
        if (err && err.statusCode === 404) {
          logger.info('All unblocked users deactivated, ignoring unblocks.');
        } else if (err) {
          logger.error('Error /users/lookup', err.statusCode, err.data, err,
            'ignoring', uidsToQuery.length, 'unblocks');
        } else {
          // If a uid was present in the response, the user is not deactivated,
          // so go ahead and record it as an unblock.
          var indexedResponses = _.indexBy(response, 'id_str');
          uidsToQuery.forEach(function(sink_uid) {
            if (indexedResponses[sink_uid]) {
              recordAction(source_uid, sink_uid, Action.UNBLOCK);
            }
          });
        }
      });
  }
}

/**
 * For a given BtUser, remove all but 4 most recent batches of blocks.
 *
 * @param {String} userId The uid for the BtUser whose blocks we want to trim.
 */
function destroyOldBlocks(userId) {
  BlockBatch.findAll({
    source_uid: userId,
    offset: 4,
    order: 'id DESC'
  }).error(function(err) {
    logger.error(err);
  }).success(function(blockBatches) {
    if (blockBatches && blockBatches.length > 0) {
      BlockBatch.destroy({
        id: {
          in: _.pluck(blockBatches, 'id')
        }
      }).error(function(err) {
        logger.error(err);
      }).success(function(destroyedCount) {
        logger.info('Trimmed', destroyedCount, 'old BlockBatches for', userId);
      });
    }
  });
}

function recordAction(source_uid, sink_uid, type) {
  // Most of the contents of the action to be created. Stored here because they
  // are also useful to query for previous actions.
  var actionContents = {
    source_uid: source_uid,
    sink_uid: sink_uid,
    type: type,
    'status': Action.DONE
  }

  Action.find({
    where: _.extend(actionContents, {
      updatedAt: {
        // Look only at actions updated within the last day.
        gt: new Date(new Date() - 60000)
      }
    })
  }).error(function(err) {
    logger.error(err)
  }).success(function(prevAction) {
    // No previous action found, so create one. Add the cause and cause_uid
    // fields, which we didn't use for the query.
    if (!prevAction) {
      Action.create(_.extend(actionContents, {
        cause: Action.EXTERNAL,
        cause_uid: null
      })).error(function(err) {
        logger.error(err);
      })
    }
  })
}

module.exports = {
  updateBlocks: updateBlocks
};

if (require.main === module) {
  findAndUpdateBlocks();
  setInterval(findAndUpdateBlocks, 5000);
}
})();
