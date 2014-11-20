'use strict';
(function() {
var twitterAPI = require('node-twitter-api'),
    Q = require('q'),
    fs = require('fs'),
    tls = require('tls'),
    upnode = require('upnode'),
    /** @type{Function|null} */ timeago = require('timeago'),
    _ = require('sequelize').Utils._,
    setup = require('./setup'),
    subscriptions = require('./subscriptions'),
    updateUsers = require('./update-users');

var twitter = setup.twitter,
    logger = setup.logger,
    configDir = setup.configDir,
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
  return BtUser.find({
    where: ["(updatedAt < DATE_SUB(NOW(), INTERVAL 1 DAY) OR updatedAt IS NULL) AND deactivatedAt IS NULL"],
    order: 'BtUsers.updatedAt ASC'
  }).then(function(user) {
    // Gracefully exit function if no BtUser matches criteria above.
    if (user === null) {
      return Q.reject("No users need blocks updated at this time.");
    } else {
      // HACK: mark the user as updated. This allows us to iterate through the
      // BtUsers table looking for users that haven't had their blocks updated
      // recently, instead of having to iterate on a join of BlockBatches with
      // BtUsers.
      user.updatedAt = new Date();
      // We structure this as a second fetch rather than using sequelize's include
      // functionality, because ordering inside nested selects doesn't appear to
      // work (https://github.com/sequelize/sequelize/issues/2121).
      return [user.save(), user.getBlockBatches({
        // Get the latest BlockBatch for the user and skip if < 1 day old.
        // Note: We count even incomplete BlockBatches towards being 'recently
        // updated'. This prevents the setInterval from repeatedly initiating
        // block fetches for the same user, because the first block fetch will
        // create an up-to-date BlockBatch immediately (even though it will take
        // some time to fill it and mark it complete).
        limit: 1,
        order: 'updatedAt desc'
      })];
    }
  }).spread(function(user, batches) {
    if (batches && batches.length > 0) {
      var batch = batches[0];
      logger.debug('User', user.uid, 'has updated blocks from',
        timeago(new Date(batch.createdAt)));
      if ((new Date() - new Date(batch.createdAt)) > ONE_DAY_IN_MILLIS) {
        return updateBlocks(user);
      } else {
        return Q.resolve(null);
      }
    } else {
      logger.warn('User', user.uid, 'has no updated blocks ever.');
      return updateBlocks(user);
    }
  }).catch(function(err) {
    logger.error(err);
  });
}

var activeFetches = {};

function updateBlocksForUid(uid) {
  logger.info('Updating blocks for uid', uid);
  return BtUser.find(uid).then(updateBlocks).catch(function (err) {
    logger.error(err);
  });
}

/**
 * For a given BtUser, fetch all current blocks and store in DB.
 *
 * @param {BtUser} user The user whose blocks we want to fetch.
 */
function updateBlocks(user) {
  // Don't create multiple pending block update requests at the same time.
  if (activeFetches[user.uid]) {
    logger.info('User', user, 'already updating blocks, skipping duplicate.');
    return Q.resolve(null);
  } else {
    logger.info('Updating blocks for', user);
  }

  /**
   * For a given BtUser, fetch all current blocks and store in DB.
   *
   * @param {BtUser} user The user whose blocks we want to fetch.
   * @param {BlockBatch|null} blockBatch The current block batch in which we will
   *   store the blocks. Null for the first fetch, set after successful first
   *   request.
   * @param {string|null} cursor When cursoring, the current cursor for the
   *   Twitter API.
   */
  function fetchAndStoreBlocks(user, blockBatch, cursor) {
    // A function that can simply be called again to run this once more with an
    // updated cursor.
    var getMore = fetchAndStoreBlocks.bind(null, user, blockBatch);
    var currentCursor = cursor || '-1';
    return Q.ninvoke(twitter,
      'blocks', 'ids', {
        // Stringify ids is very important, or we'll get back numeric ids that
        // will get subtly mangled by JS.
        stringify_ids: true,
        cursor: currentCursor
      },
      user.access_token,
      user.access_token_secret
    ).then(function(results) {
      // Lazily create a BlockBatch after Twitter responds successfully. Avoids
      // creating excess BlockBatches only to get rate limited.
      if (!blockBatch) {
        return BlockBatch.create({
          source_uid: user.uid,
          size: 0
        }).then(function(createdBlockBatch) {
          blockBatch = createdBlockBatch;
          return handleIds(blockBatch, currentCursor, results[0]);
        });
      } else {
        return handleIds(blockBatch, currentCursor, results[0]);
      }
    }).then(function(nextCursor) {
      // Check whether we're done or need to grab the items at the next cursor.
      if (nextCursor === '0') {
        return finalizeBlockBatch(blockBatch);
      } else {
        logger.debug('Cursoring ', nextCursor);
        return fetchAndStoreBlocks(user, blockBatch, nextCursor);
      }
    }).catch(function (err) {
      if (err.statusCode === 429) {
        // The rate limit for /blocks/ids is 15 requests per 15 minute window.
        // Since the endpoint returns up to 5,000 users, that means users with
        // greater than 15 * 5,000 = 75,000 blocks will always get rate limited
        // when we try to update blocks. So we have to remember state and keep
        // trying after a delay to let the rate limit expire.
        if (!blockBatch) {
          logger.info('Rate limited /blocks/ids', user);
          return Q.resolve(null);
        } else {
          logger.info('Rate limited /blocks/ids', user,
            'Trying again in 15 minutes.');
          return Q.delay(15 * 60 * 1000)
            .then(function() {
              return fetchAndStoreBlocks(user, blockBatch, currentCursor);
            });
        }
      } else {
        logger.error('Error /blocks/ids', err.statusCode, err.data, err);
        return Q.resolve(null);
      }
    });
  }

  activeFetches[user.uid] = fetchAndStoreBlocks(user, null, null);
  return activeFetches[user.uid];
}

/**
 * Given results from Twitter, store as appropriate.
 * @param {BlockBatch|null} blockBatch BlockBatch to add blocks to. Null for the
 *   first batch, set if cursoring is needed.
 * @param {string} currentCursor
 * @param {Object} results
 */
function handleIds(blockBatch, currentCursor, results) {
  // Update the current cursor stored with the blockBatch.
  blockBatch.currentCursor = currentCursor;
  blockBatch.size += results.ids.length;
  var blockBatchPromise = blockBatch.save();

  // Now we create block entries for all the blocked ids. Note: setting
  // BlockBatchId explicitly here doesn't show up in the documentation,
  // but it seems to work.
  var blocksToCreate = results.ids.map(function(id) {
    return {
      sink_uid: id,
      BlockBatchId: blockBatch.id
    };
  });
  var blockPromise = Block.bulkCreate(blocksToCreate);

  return Q.all([blockBatchPromise, blockPromise])
    .then(function() {
      return Q.resolve(results.next_cursor_str);
    });
}

function finalizeBlockBatch(blockBatch) {
  logger.info('Finished fetching blocks for user', blockBatch.source_uid);
  // Mark the BlockBatch as complete and save that bit.
  blockBatch.complete = true;
  return blockBatch
    .save()
    .then(function(blockBatch) {
      diffBatchWithPrevious(blockBatch);
      // Prune older BlockBatches for this user from the DB.
      destroyOldBlocks(blockBatch.source_uid);
      delete activeFetches[blockBatch.source_uid];
      return Q.resolve(blockBatch);
    });
}

/**
 * Given a list of uids newly observed, add them to the TwitterUsers table in
 * case they are not currently there. This triggers update-users.js to fetch
 * data about that uid, like screen name and display name.
 * @param {Array.<string>} idList A list of stringified Twitter uids.
 */
function addIdsToTwitterUsers(idList) {
  return TwitterUser.bulkCreate(idList.map(function(id) {
    return {uid: id};
  }), {
    // Use ignoreDuplicates so we don't overwrite already fleshed-out users.
    ignoreDuplicates: true
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
      id: { lte: currentBatch.id },
      complete: true
    },
    order: 'id DESC',
    limit: 2
  }).then(function(batches) {
    if (batches && batches.length === 2) {
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
        var start = process.hrtime();
        var addedBlockIds = _.difference(currentBlockIds, oldBlockIds);
        var removedBlockIds = _.difference(oldBlockIds, currentBlockIds);
        var elapsed = process.hrtime(start)[1] / 1000000;
        logger.debug('Block diff for', source_uid,
          'added:', addedBlockIds, 'removed:', removedBlockIds,
          'current size:', currentBlockIds.length,
          'time:', elapsed);
        addedBlockIds.forEach(function(sink_uid) {
          recordAction(source_uid, sink_uid, Action.BLOCK);
        });
        // Make sure any new ids are in the TwitterUsers table.
        addIdsToTwitterUsers(addedBlockIds);
        recordUnblocksUnlessDeactivated(source_uid, removedBlockIds);
      });
    } else {
      logger.warn('Insufficient block batches to diff.');
      // If it's the first block fetch for this user, make sure all the blocked
      // uids are in TwitterUsers.
      if (currentBatch) {
        currentBatch.getBlocks().then(function(blocks) {
          addIdsToTwitterUsers(_.pluck(blocks, 'sink_uid'));
        });
      }
    }
  }).catch(function(err) {
    logger.error(err);
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
    where: {
      source_uid: userId
    },
    offset: 4,
    order: 'id DESC'
  }).then(function(blockBatches) {
    if (blockBatches && blockBatches.length > 0) {
      return BlockBatch.destroy({
        id: {
          in: _.pluck(blockBatches, 'id')
        }
      })
    } else {
      return Q.resolve(0);
    }
  }).then(function(destroyedCount) {
    logger.info('Trimmed', destroyedCount, 'old BlockBatches for', userId);
  }).catch(function(err) {
    logger.error(err);
  });
}

function recordAction(source_uid, sink_uid, type) {
  // Most of the contents of the action to be created. Stored here because they
  // are also useful to query for previous actions.
  var actionContents = {
    source_uid: source_uid,
    sink_uid: sink_uid,
    type: type,
    // Ignore previous externally-caused actions, because the user may have
    // blocked, unblocked, and reblocked an account.
    cause: {
      not: Action.EXTERNAL
    },
    'status': Action.DONE
  }

  Action.find({
    where: _.extend(actionContents, {
      updatedAt: {
        // Look only at actions updated within the last day.
        // Note: For this to be correct, we need to ensure that updateBlocks is
        // always called within a day of performing a block or unblock
        // action, which is true because of the regular update process.
        gt: new Date(new Date() - ONE_DAY_IN_MILLIS)
      }
    })
  }).then(function(prevAction) {
    // No previous action found, so create one. Add the cause and cause_uid
    // fields, which we didn't use for the query.
    if (!prevAction) {
      return Action.create(_.extend(actionContents, {
        cause: Action.EXTERNAL,
        cause_uid: null
      }));
    } else {
      return null;
    }
  // Enqueue blocks and unblocks for subscribing users.
  }).then(function(newAction) {
    if (newAction) {
      return subscriptions.fanout(newAction);
    } else {
      return null;
    }
  }).catch(function(err) {
    logger.error(err)
  })
}

/**
 * Set up a dnode RPC server (using the upnode library, which can handle TLS
 * transport) so other daemons can send requests to update blocks.
 * TODO: Require client authentication with a cert.
 */
function setupServer() {
  var opts = {
    key: fs.readFileSync(configDir + 'rpc.key'),
    cert: fs.readFileSync(configDir + 'rpc.crt'),
    ca: fs.readFileSync(configDir + 'rpc.crt'),
    requestCert: true,
    rejectUnauthorized: true
  };
  var server = tls.createServer(opts, function (stream) {
    var up = upnode(function(client, conn) {
      this.updateBlocksForUid = function(uid, cb) {
        updateBlocksForUid(uid).then(function() {
          cb();
        });
      };
    });
    up.pipe(stream).pipe(up);
  });
  server.listen(7000);
}

module.exports = {
  updateBlocks: updateBlocks
};

if (require.main === module) {
  setInterval(findAndUpdateBlocks, 60 * 1000);
  setupServer();
}
})();
