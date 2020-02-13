//'use strict';
var twitterAPI = require('node-twitter-api'),
    Q = require('q'),
    fs = require('fs'),
    path = require('path'),
    tls = require('tls'),
    https = require('https'),
    /** @type{Function|null} */ timeago = require('timeago'),
    _ = require('lodash'),
    sequelize = require('sequelize'),
    setup = require('./setup'),
    subscriptions = require('./subscriptions'),
    updateUsers = require('./update-users'),
    util = require('./util'),
    prom = require('prom-client');

var twitter = setup.twitter,
    logger = setup.logger,
    configDir = setup.configDir,
    BtUser = setup.BtUser,
    TwitterUser = setup.TwitterUser,
    Action = setup.Action,
    BlockBatch = setup.BlockBatch,
    Block = setup.Block;

var ONE_DAY_IN_MILLIS = 86400 * 1000;
var shuttingDown = false;

var NO_UPDATE_NEEDED = new Error("No users need blocks updated at this time.");

/**
 * Find a user who hasn't had their blocks updated recently and update them.
 */
function findAndUpdateBlocks() {
  if (setup.pendingTwitterRequests() > 10000) {
    logger.info('Skipping processing; too many pending Twitter requests at',
      setup.pendingTwitterRequests());
    return;
  }
  return BtUser.findOne({
    where: sequelize.literal(
      "(updatedAt < DATE_SUB(NOW(), INTERVAL 1 DAY) OR updatedAt IS NULL) AND deactivatedAt IS NULL AND NOT paused AND uid IN (SELECT DISTINCT(author_uid) FROM Subscriptions)"),
    order: [['updatedAt', 'ASC']]
  }).then(function(user) {
    // Gracefully exit function if no BtUser matches criteria above.
    if (user === null) {
      logger.info('no user needs update')
      return Q.reject(NO_UPDATE_NEEDED);
    } else {
      // HACK: mark the user as updated. This allows us to iterate through the
      // BtUsers table looking for users that haven't had their blocks updated
      // recently, instead of having to iterate on a join of BlockBatches with
      // BtUsers.
      user.changed('updatedAt', true);
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
        order: [['updatedAt', 'desc']]
      })];
    }
  }).spread(function(user, batches) {
    if (batches && batches.length > 0) {
      var batch = batches[0];
      logger.info('User', user.uid, 'has updated blocks from',
        timeago(new Date(batch.createdAt)));
      if ((new Date() - new Date(batch.createdAt)) > ONE_DAY_IN_MILLIS) {
        stats.updateRequests.labels('self').inc()
        return updateBlocks(user);
      } else {
        return Q.resolve(null);
      }
    } else {
      logger.warn('User', user.uid, 'has no updated blocks ever.');
      return updateBlocks(user);
    }
  }).catch(function(err) {
    if (err === NO_UPDATE_NEEDED) {
      logger.info(err.message);
    } else {
      logger.error(err);
    }
  });
}

var activeFetches = new Map();

var stats = {
  numActiveFetches: new prom.Gauge({
    name: 'num_active_fetches',
    help:  'Number of active block fetches.'
  }),
  updateRequests: new prom.Counter({
    name: 'update_requests',
    help:  'Number of requests to update blocks',
    labelNames: ['caller']
  }),
  finalize: new prom.Counter({
    name: 'finalize',
    help:  'Number of times finalizeBlockBatch was reached.'
  }),
  finalizeDone: new prom.Counter({
    name: 'finalize_done',
    help:  'finalizeBlockBatch\'s Promise completed.'
  }),
  deleteFromActive: new prom.Counter({
    name: 'delete_from_active',
    help:  'Fetch was deleted from activeFetches map.'
  }),
  diffTimeNanos: new prom.Summary({
    name: 'diff_time_nanos',
    help:  'Time taken to diff block batches.'
  }),
}

setInterval(function() {
  stats.numActiveFetches.set(activeFetches.size);
}, 1000)

function updateBlocksForUid(uid) {
  return BtUser.findByPk(uid).then(updateBlocks).catch(function (err) {
    logger.error(err);
  });
}

/**
 * For a given BtUser, fetch all current blocks and store in DB.
 *
 * @param {BtUser} user The user whose blocks we want to fetch.
 */
async function updateBlocks(user) {
  if (!user) {
    return Q.reject('No user found.');
  } else if (activeFetches.has(user.uid)) {
    // Don't create multiple pending block update requests at the same time.
    logger.info('User', user, 'already updating, skipping duplicate. Status:',
      activeFetches.get(user.uid));
    return Q.resolve(null);
  } else {
    logger.info('Updating blocks for', user);
  }
  var fetchPromise = fetchAndStoreBlocks(user);
  // Remember there is a fetch running for a user so we don't overlap.
  activeFetches.set(user.uid, fetchPromise);
  // Once the promise resolves, success or failure, delete the entry in
  // activeFetches so future fetches can proceed.
  try {
    var result = await fetchPromise;
  } catch (err) {
    logger.error(err);
  } finally {
    logger.info('Deleting activeFetches[', user, '].');
    stats.deleteFromActive.inc();
    activeFetches.delete(user.uid);
  }

  return result;
}

async function fetchAndStoreBlocks(user) {
  // ids is an array of arrays, each containing the ids resulting from one block
  // fetch.
  var ids = [];
  // Total running count of blocks fetched.
  var size = 0;
  var nextCursor = '-1';
  for (var i = 0; i < 50; i++) {
    try {
      var results = await Q.ninvoke(twitter,
        'blocks', 'ids', {
          // Stringify ids is very important, or we'll get back numeric ids that
          // will get subtly mangled by JS.
          stringify_ids: true,
          cursor: nextCursor
        },
        user.access_token,
        user.access_token_secret
      );
    } catch (err) {
      if (err.statusCode === 429) {
        // The rate limit for /blocks/ids is 15 requests per 15 minute window.
        // Since the endpoint returns up to 5,000 users, that means users with
        // greater than 15 * 5,000 = 75,000 blocks will always get rate limited
        // when we try to update blocks. So we have to remember state and keep
        // trying after a delay to let the rate limit expire.
        if (i === 0) {
          // If we got rate limited on the very first request, don't bother retrying.
          logger.info('Rate limited /blocks/ids', user);
          return Q.resolve(null);
        } else {
          logger.info('Rate limited /blocks/ids', user, 'Trying again in 15 minutes.');
          await Q.delay(15 * 60 * 1000);
        }
      } else if (err.statusCode) {
        logger.error('Error /blocks/ids', user, err.statusCode, err.data);
        return Q.resolve(null);
      } else {
        logger.error('Error /blocks/ids', user, err);
        return Q.resolve(null);
      }
    }
    logger.trace('/blocks/ids', user, nextCursor, results[0]);
    ids.push(results[0].ids);
    size += results[0].ids.length
    nextCursor = results[0].next_cursor_str;
    if (nextCursor === '0') {
      break;
    }
  }

  var blockBatch = await BlockBatch.create({
    source_uid: user.uid,
    size: size,
    complete: false
  });

  for (var i = 0; i < ids.length; i++) {
    var blocksToCreate = ids[i].map(function(id) {
      // Setting BlockBatchId explicitly here doesn't show up in the documentation,
      // but it seems to work.
      return {
        sink_uid: id,
        BlockBatchId: blockBatch.id
      };
    });

    await Block.bulkCreate(blocksToCreate);
  }

  user.blockCount = size;
  await user.save()
  return finalizeBlockBatch(blockBatch);
}

// Error thrown when diffing blocks and no previous complete block batch exists.
var INSUFFICIENT_BLOCK_BATCHES = 'Insufficient block batches to diff';

function finalizeBlockBatch(blockBatch) {
  stats.finalize.inc();
  if (!blockBatch) {
    return Q.reject('No blockBatch passed to finalizeBlockBatch');
  }
  logger.info('Finished fetching blocks for user', blockBatch.source_uid,
    'batch', blockBatch.id);
  // Exit early if we are in the shutdown phase.
  if (shuttingDown) {
    return Q.resolve(null);
  }
  // If the block batch has 300000 or more entries we skip the diff. It's
  // likely to be too expensive. Note: this shouldn't happen because we will
  // only fetch 50 * 5000 = 250k blocks.
  var diffPromise;
  if (blockBatch.size < 300000) {
    diffPromise = diffBatchWithPrevious(blockBatch);
  } else {
    diffPromise = Promise.resolve()
  }
  return diffPromise.catch(function(err) {
    // If there was no previous complete block batch to diff against, that's
    // fine. Continue with saving the block batch. Any other error, however,
    // should be propagated.
    if (err === INSUFFICIENT_BLOCK_BATCHES) {
      return Q.resolve(null);
    } else {
      return Q.reject(err);
    }
  }).then(function() {
    // Prune older BlockBatches for this user from the DB.
    return destroyOldBlocks(blockBatch.source_uid);
  }).then(function() {
    blockBatch.complete = true;
    return blockBatch.save();
  }).catch(function(err) {
    logger.error(err);
  }).finally(function() {
    stats.finalizeDone.inc();
  });
}

/**
 * Given a list of uids newly observed, add them to the TwitterUsers table in
 * case they are not currently there. This triggers update-users.js to fetch
 * data about that uid, like screen name and display name.
 * @param {Array.<string>} idList A list of stringified Twitter uids.
 * @returns {Promise.<Array.<TwitterUser> >} A list of TwitterUsers created.
 */
function addIdsToTwitterUsers(idList) {
  var chunkSize = 100;
  return TwitterUser.bulkCreate(idList.slice(0, chunkSize).map(function(id) {
    return {uid: id};
  }), {
    // Use ignoreDuplicates so we don't overwrite already fleshed-out users.
    ignoreDuplicates: true
  }).then(function() {
    if (idList.length > chunkSize) {
      return addIdsToTwitterUsers(idList.slice(chunkSize));
    } else {
      return null;
    }
  });
}

/**
 * Compare a BlockBatch with the immediately previous completed BlockBatch
 * for the same uid. Generate Actions with cause = external from the result.
 * @param {BlockBatch} currentBatch The batch to compare to its previous batch.
 * @returns {Promise.<null>} Resolves when diff is done and fanned out.
 */
function diffBatchWithPrevious(currentBatch) {
  var source_uid = currentBatch.source_uid;
  return BlockBatch.findOne({
    where: {
      source_uid: source_uid,
      id: { lte: currentBatch.id },
      complete: true
    },
    order: [['id', 'DESC']]
  }).then(function(oldBatch) {
    if (!oldBatch) {
      logger.info('Insufficient block batches to diff for', currentBatch.source_uid);
      // If it's the first block fetch for this user, make sure all the blocked
      // uids are in TwitterUsers.
      if (currentBatch) {
        return currentBatch.getBlocks().then(function(blocks) {
          return addIdsToTwitterUsers(_.map(blocks, 'sink_uid'));
        }).then(function() {
          return Q.reject(INSUFFICIENT_BLOCK_BATCHES);
        });
      } else {
        return Q.reject(INSUFFICIENT_BLOCK_BATCHES);
      }
    }
    logger.info('Getting blocks for batches', currentBatch.id, oldBatch.id);
    return [oldBatch, currentBatch.getBlocks(), oldBatch.getBlocks()];
  }).spread(function(oldBatch, currentBlocks, oldBlocks) {
    var currentBlockIds = _.map(currentBlocks, 'sink_uid');
    var oldBlockIds = _.map(oldBlocks, 'sink_uid');
    var start = process.hrtime();
    var addedBlockIds = _.difference(currentBlockIds, oldBlockIds);
    var removedBlockIds = _.difference(oldBlockIds, currentBlockIds);
    var elapsedNanos = process.hrtime(start)[1];
    stats.diffTimeNanos.observe(elapsedNanos);
    logger.info('Block diff for', source_uid,
      'added:', addedBlockIds.length, 'removed:', removedBlockIds.length,
      'current size:', currentBlockIds.length,
      'old size:', oldBlockIds.length,
      'msecs:', Math.round(elapsedNanos / 1000000));

    // Make sure any new ids are in the TwitterUsers table. Don't block the
    // overall Promise on the result, though.
    addIdsToTwitterUsers(addedBlockIds);

    // Enqueue blocks for users who subscribe. This can be a large number of
    // blocks, so we use promiseMap, which waits for each one to succeed before
    // starting the next. We previously used addedBlockIds.map, but when someone
    // blocked 100k users between visits, trying to create all 100k promises
    // chewed up all our memory and caused crashes.
    // NOTE: subscription fanout for unblocks happens within
    // recordUnblocksUnlessDeactivated.
    var blockActionsPromise = util.promiseMap(addedBlockIds, function(sink_uid) {
      // Actions are not recorded if they already exist, i.e. are not
      // external actions. Those come back as null and are filtered in
      // fanoutActions.
      return recordAction(source_uid, sink_uid, Action.BLOCK);
    }).then(function(blockActions) {
      logger.debug('Calling fanoutActions for', source_uid, 'with', blockActions.length, 'actions');
      subscriptions.fanoutActions(blockActions);
    });

    var unblockActionsPromise = [];
    if (removedBlockIds.length > 0) {
      unblockActionsPromise = recordUnblocksUnlessDeactivated(
        source_uid, removedBlockIds);
    }
    return [blockActionsPromise, unblockActionsPromise];
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
 * if an account deactivates and reactivates, there will be an external block entry
 * in Actions but no corresponding external unblock. This is fine. The main
 * reason we care about not recording unblocks for accounts that were really just
 * deactivated is to avoid triggering unblock/reblock waves for subscribers when
 * a shared block list includes accounts that frequently deactivate / reactivate.
 * Also, part of the product spec for shared block lists is that blocked users
 * remain on shared lists even if they deactivate.
 *
 * @param {string} source_uid Uid of user doing the unblocking.
 * @param {Array.<string>} sink_uids List of uids that disappeared from a user's
 *   /blocks/ids.
 * @returns {Promise.<Array.<Action> >} An array of recorded unblock actions.
 */
function recordUnblocksUnlessDeactivated(source_uid, sink_uids) {
  return BtUser.findByPk(source_uid)
    .then(function(user) {
      if (!user) {
        return Q.reject("No user found for " + source_uid);
      }
      return updateUsers.updateUsers(sink_uids);
    }).then(function(usersMap) {
      var recordedActions = sink_uids.map(function(sink_uid) {
        // If a uid was present in the response, the user is not deactivated,
        // so go ahead and record it as an unblock.
        if (usersMap[sink_uid]) {
          return recordAction(source_uid, sink_uid, Action.UNBLOCK);
        } else {
          return Q.resolve(null);
        }
      });
      return Q.all(recordedActions);
    }).then(function(actions) {
      return subscriptions.fanoutActions(actions);
    })
}

/**
 * For a given BtUser, remove all but 4 most recent batches of blocks.
 *
 * @param {String} userId The uid for the BtUser whose blocks we want to trim.
 */
function destroyOldBlocks(userId) {
  return BlockBatch.findAll({
    where: {
      source_uid: userId
    },
    order: [['id', 'DESC']]
  }).then(function(blockBatches) {
    if (!blockBatches || blockBatches.length === 0) {
      return Q.resolve(0);
    }

    // We want to leave at least 2 block batches where the 'complete' flag is
    // set. So we iterate through in order until we've seen that many, then
    // delete older ones.
    for (var i = 0, completeCount = 0; i < blockBatches.length; i++) {
      if (blockBatches[i].complete) {
        completeCount++;
        if (completeCount >= 2) {
          break;
        }
      }
    }
    return Q.all(blockBatches.slice(i).map(function(batch) {
      return batch.destroy();
    }));
  }).then(function(destroyedBatches) {
    logger.info('Trimmed', destroyedBatches.length, 'old BlockBatches for', userId);
  }).catch(function(err) {
    logger.error(err);
  });
}

/**
 * Given an observed block or unblock, possibly record it in the Actions table.
 * The block or unblock may have shown up because the user actually blocked or
 * unblocked someone in the Twitter app, or it may have shown up because Block
 * Together recently executed a block or unblock action. In the latter case we
 * don't want to record a duplicate in the Actions table; The existing record,
 * in 'done' state, tells the whole story. So we check for such past actions and
 * don't record a new action if they exist.
 *
 * @return {Promise.<Action|null>} createdAction If the action was indeed
 *   externally triggered and we recorded it, the action created. Otherwise null.
 */
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

  // Look for the most recent block or unblock action applying to this sink_uid.
  // If it's the same type as the action we're trying to record, it's an action
  // caused internally to Block Together and we shouldn't record it; It would be
  // a duplicate.
  // If it's a different type (i.e. we are recording a block and the most recent
  // action was an unblock), go ahead and record.
  return Action.findOne({
    where: _.extend(_.clone(actionContents), {
      type: [Action.BLOCK, Action.UNBLOCK],
    }),
    order: [['updatedAt', 'DESC']],
  }).then(function(prevAction) {
    // No previous action found, or previous action was a different type, so
    // create a new action. Add the cause and cause_uid fields, which we didn't
    // use for the query.
    if (!prevAction || prevAction.type != type) {
      return Action.create(_.extend(actionContents, {
        cause: Action.EXTERNAL,
        cause_uid: null
      }));
    } else {
      return null;
    }
  }).catch(function(err) {
    logger.error(err)
  })
}

var tlsOpts = {
  key: fs.readFileSync(path.join(configDir, 'rpc.key')),
  cert: fs.readFileSync(path.join(configDir, 'rpc.crt')),
  ca: fs.readFileSync(path.join(configDir, 'rpc.crt')),
  requestCert: true,
  rejectUnauthorized: true
};

/**
 * Set up a simple HTTPS server so other daemons can send requests to update blocks.
 * The server expects a JSON POST with fields "uid" and "callerName." The latter
 * is the name of the script that requested the block update, for logging
 * purposes.
 * The server uses a self-signed cert, which clients will verify. It also
 * requires a client cert. The client happens to use the same self-signed cert
 * and key to identify itself that the server does.
 */
function setupServer() {
  var server = https.createServer(tlsOpts, function (request, response) {
    request.on('data', function(chunk) {
      // Assume we all the data shows up in one chunk.
      var args = JSON.parse(chunk.toString('utf-8'));
      stats.updateRequests.labels(args.callerName).inc()
      if (activeFetches.has(args.uid)) {
        // Don't create multiple pending block update requests at the same time.
        logger.info('User', args.uid,
          'already updating, skipping duplicate from', args.callerName);
        response.end()
      } else {
        logger.info('Fulfilling remote update request for', args.uid,
          'from', args.callerName);
        updateBlocksForUid(args.uid).then(function() {
        }).catch(function(err) {
          logger.error(err);
        }).finally(() => {
          response.end();
        });
      }
    });
  });
  // The server will use HTTP keepalive by default, but also set a timeout
  // on the TCP socket so clients can keep connections open a long time. The
  // Node default is two minutes.
  server.on('connection', function(socket) {
    socket.setTimeout(10000 * 1000);
    socket.unref();
    socket.on('error', function(err) {
      if (err.code != 'ECONNRESET') {
        logger.error(err);
      }
    });
  });
  // Don't let the RPC server keep the process alive during a graceful exit.
  server.unref();
  server.listen(setup.config.updateBlocks.port);
  return server;
}

module.exports = {
  updateBlocks: updateBlocks,
  recordAction: recordAction
};

async function processEternally() {
  while (!shuttingDown) {
    logger.info('tick');
    findAndUpdateBlocks();
    await Q.delay(1000);
  }
}

if (require.main === module) {
  logger.info('Starting up.');
  var server = setupServer();
  var statsServer = setup.statsServer(6440);
  var gracefulExit = function() {
    // On the second try, exit straight away.
    if (shuttingDown) {
      process.exit(0);
    } else {
      shuttingDown = true;
      logger.info('Closing up shop.');
      server.close();
      statsServer.close();
      setup.gracefulShutdown();
    }
  }
  process.on('SIGINT', gracefulExit).on('SIGTERM', gracefulExit);
  processEternally();
}
