'use strict';
(function() {

/**
 * Queueing and processing of actions (block, unblock, mute, etc).
 */
var twitterAPI = require('node-twitter-api'),
    https = require('https'),
    fs = require('fs'),
    Q = require('q'),
    _ = require('lodash'),
    util = require('./util'),
    setup = require('./setup'),
    prom = require('prom-client'),
    verifyCredentials = require('./verify-credentials');

var twitter = setup.twitter,
    sequelize = setup.sequelize,
    logger = setup.logger,
    BtUser = setup.BtUser,
    Action = setup.Action;

var stats = {
  usersWithActions: new prom.Gauge({
    name: 'users_with_actions',
    help: 'Number of users with pending actions'
  }),
  actionsBegun: new prom.Counter({
    name: 'actions_begun',
    help: 'Number of actions begun',
    labelNames: ['type']
  }),
  actionsFinished: new prom.Counter({
    name: 'actions_finished',
    help: 'Number of actions finished',
    labelNames: ['type', 'status']
  })
}

const processingIntervalSeconds = 10;
const userBatchSize = 65;

/**
 * Given a list of uids, enqueue them all in the Actions table, and trigger a
 * batch of processing Actions for the source user.
 *
 * TODO: Certain sources, like mention replays when stream.js restarts, can
 * cause fresh Actions to be enqueued even when those Actions have previously
 * been cancelled, e.g. cancelled-following. These Actions are very likely to be
 * cancelled again, and we should probably avoid enqueuing them in order to not
 * clutter up the Actions list with entries that are confusing to the user.
 *
 * @param {string} source_uid The user who wants to perform these actions.
 * @param {Array.<string>} list A list of uids to target with the actions.
 * @param {Number} type The type of action, e.g block/unblock.
 * @param {Number} cause The cause to be recorded on the Actions.
 * @param {string} cause_uid Uid of the user who caused the actions, e.g.
 *    the author of a shared block list if cause is 'bulk-manual-block.'
 */
function queueActions(source_uid, list, type, cause, cause_uid) {
  return Action.bulkCreate(
    list.map(function(sink_uid) {
      return {
        source_uid: source_uid,
        sink_uid: sink_uid,
        type: type,
        cause: cause,
        cause_uid: cause_uid,
        'status': Action.PENDING
      }
    })).then(function() {
      return BtUser.findById(source_uid);
    }).then(function(user) {
      user.pendingActions = true;
      return user.save();
    });
}

/**
 * Find all pending block actions in the queue, validate and execute them.
 *
 * Validation is a little tricky.  We want to check whether a given
 * user is following the target. The relevant endpoint is friendships/lookup,
 * https://dev.twitter.com/docs/api/1.1/get/friendships/lookup.
 * That endpoint has a rate limit of 15 requests per 15 minutes, which means
 * bulk blocking would proceed very slowly if we called it once per block
 * action.
 *
 * However, friendships/lookup supports bulk querying of up to 100 users at
 * once. So we group pending actions by source_uid, then do a second query by
 * that uid to get up to 100 of their oldest pending actions. To make sure this
 * query never gets jammed up with unprocessable actions, it's important that
 * each action queried gets moved out of pending state in one way or
 * another.
 *
 * Note that the block endpoint can only block one user
 * at a time, but it does not appear to have a rate limit.
 */
function processActions() {
  if (setup.pendingTwitterRequests() > 10000) {
    logger.info('Skipping processing; too many pending Twitter requests at',
      setup.pendingTwitterRequests());
    return;
  }
  BtUser.findAll({
    where: {
      pendingActions: true,
      paused: false
    },
    // Randomize which users get processed, so users with thousands of pending
    // actions don't block progress for users with only a few.
    order:  [
      [sequelize.fn('RAND', '')]
    ],
    limit: userBatchSize
  }).then(function(users) {
    if (users && users.length > 0) {
      stats.usersWithActions.set(users.length);
      logger.info('Processing actions for', users.length, 'users');
      users.forEach(processActionsForUser);
    }
  }).catch(function(err) {
    logger.error(err);
  });
}

var workingActions = {};

/**
 * For a given user, fetch and process pending actions.
 * Actions are processed in batches of up to 100, but they must all be the same
 * type, and must be in order by createdAt. So we pick up to 100 actions that
 * match the type of the earliest available pending action for the uid.
 * @param {BtUser} user The user to process.
 */
function processActionsForUser(user) {
  var uid = user.uid;
  if (workingActions[uid]) {
    logger.warn('Skipping processing for', uid,
      'actions already in progress.', workingActions[uid]);
    return Q.resolve(null);
  }
  if (!user || user.deactivatedAt) {
    // Cancel all pending actions for deactivated or absent users.
    logger.info('User missing or deactivated', uid);
    return cancelSourceDeactivated(user).then(function() {
      return Q.resolve(null);
    });
  }
  // We use a separate fetch here rather than an include because the actions
  // for a user can be quite large. The SQL generated by a BtUser.find
  // with an include statement has two problems: (1) It doesn't respect
  // the limit clause, and (2) each row returned for Actions also includes
  // the full BtUser object, which contains some long strings. This is
  // very wasteful.
  return Action.findAll({
    // Out of the available pending actions on this user,
    // pick up to 100 with the earliest createdAt times.
    where: {
      status: Action.PENDING,
      source_uid: uid
    },
    order: 'createdAt ASC',
    limit: 100
  }).then(function(actions) {
    if (actions.length === 0) {
      user.pendingActions = false;
      return user.save().then(function() {
        Q.resolve(null);
      });
    } else {
      // Order across action types can be important, for instance when there are
      // both a block and an unblock action enqueued. We get 100 actions, then
      // slice out the first run of actions that all have the same type, and
      // run those actions.
      var firstActionType = actions[0].type;
      var firstDiffIndex = _.findIndex(actions, function(action) {
        return action.type !== firstActionType;
      });
      logger.debug("firstDiffIndex", firstDiffIndex);
      var run = actions;
      if (firstDiffIndex !== -1) {
        logger.debug('Skipping some actions in this run because they are not',
          firstActionType);
        run = actions.slice(0, firstDiffIndex);
      }
      workingActions[uid] = 1;
      var processingPromise = null;
      stats.actionsBegun.labels(firstActionType).inc(run.length);
      if (firstActionType === Action.BLOCK) {
        processingPromise = processBlocksForUser(user, run);
      } else if (firstActionType === Action.UNBLOCK) {
        processingPromise = processUnblocksForUser(user, run);
      } else if (firstActionType === Action.MUTE) {
        processingPromise = processMutesForUser(user, run);
      }
      workingActions[uid] = processingPromise;
      return processingPromise;
    }
  }).catch(function(err) {
    logger.error(err);
  }).finally(function() {
    delete workingActions[uid];
    return Q.resolve(null);
  });
}

/**
 * For a uid that has been determined to be deactivated, mark all of that
 * user's pending actions with status = CANCELLED_SOURCE_DEACTIVATED.
 *
 * @param {BtUser} user User for whom to modify actions.
 */
function cancelSourceDeactivated(user) {
  return Action.update({
    status: Action.CANCELLED_SOURCE_DEACTIVATED
  }, {
    where: {
      source_uid: user.uid,
      status: Action.PENDING
    }
  }).then(function() {
    user.pendingActions = 0;
    return user.save();
  }).catch(function(err) {
    logger.error(err);
  })
}

/**
 * Cancel any pending actions caused by subscriber's subscription to author's
 * block list.
 * @param {string} subscriber_uid
 * @param {string} author_uid
 */
function cancelUnsubscribed(subscriber_uid, author_uid) {
  return Action.update({
    status: Action.CANCELLED_UNSUBSCRIBED
  }, {
    where: {
      source_uid: subscriber_uid,
      cause_uid: author_uid,
      cause: Action.SUBSCRIPTION,
      status: Action.PENDING
    }
  })
}

function doBlock(sourceBtUser, sinkUid) {
  return Q.ninvoke(twitter, 'blocks', 'create', {
      user_id: sinkUid,
      skip_status: 1
    }, sourceBtUser.access_token, sourceBtUser.access_token_secret)
    .spread(function(result, response) {
      logger.trace('/blocks/create', sourceBtUser, sinkUid,
        response.statusCode);
      return result;
    });
}

function doUnblock(sourceBtUser, sinkUid) {
  return Q.ninvoke(twitter, 'blocks', 'destroy', {
      user_id: sinkUid,
      skip_status: 1
    }, sourceBtUser.access_token, sourceBtUser.access_token_secret)
    .spread(function(result, response) {
      logger.trace('/blocks/destroy', sourceBtUser, sinkUid,
        response.statusCode);
      return result;
    });
}

function doMute(sourceBtUser, sinkUid) {
  return Q.ninvoke(twitter, 'mutes', 'users/create', {
      user_id: sinkUid,
      skip_status: 1
    }, sourceBtUser.access_token, sourceBtUser.access_token_secret)
    .spread(function(result, response) {
      logger.trace('/mutes/users/create', sourceBtUser, sinkUid,
        response.statusCode);
      return result;
    });
}

function getFriendships(btUser, sinkUids) {
  return Q.ninvoke(twitter, 'friendships', 'lookup', {
      user_id: sinkUids.join(',')
    }, btUser.access_token, btUser.access_token_secret)
    .spread(function(result, response) {
      logger.trace('/friendships/lookup', btUser, sinkUids,
        response.statusCode);
      return result;
    });
}

function processUnblocksForUser(btUser, actions) {
  // NOTE: We do not bother looking up friendships before unblocking or muting,
  // because there's no special treatment for people you follow the way there is
  // for blocks. This also means that we miss a few of the less common
  // transitions, like cancelled-duplicate, but these are probably not super
  // important.
  // Also NOTE: We kick off all unblock requests simultaneously rather than
  // sequentially in callbacks the way we do for blocks. This is probably fine.
  // The https library should simply queue the requests until there is an
  // available socket for them. We may want to simplify the blocks code to do
  // the same.
  return Q.all(actions.map(function(action) {
    if (action.type !== Action.UNBLOCK) {
      return Q.reject("Shouldn't happen: non-unblock action " + btUser.inspect() +
        " " + JSON.stringify(action.dataValues));
    }
    return doUnblock(btUser, action.sink_uid).then(function() {
      logger.info('Unblocked', btUser, '-->', action.sink_uid);
      return setActionStatus(action, Action.DONE);
    }).catch(function (err) {
      // TODO: This error handling is repeated for all actions. Abstract into
      // its own function.
      if (err && (err.statusCode === 401 || err.statusCode === 403)) {
        verifyCredentials(btUser);
        return Q.resolve(null);
      } else if (err && err.statusCode === 404) {
        logger.info('Unblock returned 404 for inactive sink_uid',
          action.sink_uid, 'cancelling action.');
        return setActionStatus(action, Action.DEFERRED_TARGET_SUSPENDED);
      } else if (err.statusCode) {
        logger.warn('Error /blocks/destroy', err.statusCode, btUser,
          '-->', action.sink_uid);
        // Don't change the state of the action: It will be retried later.
        return Q.resolve(null);
      } else {
        logger.error('Error /blocks/destroy', err);
        return Q.resolve(null);
      }
    });
  }));
}

function processMutesForUser(btUser, actions) {
  return Q.all(actions.map(function(action) {
    if (action.type !== Action.MUTE) {
      return Q.reject("Shouldn't happen: non-mute action " + btUser.inspect() +
        " " + JSON.stringify(action.dataValues));
    }
    return doMute(btUser, action.sink_uid).then(function() {
      logger.info('Muted', btUser, '-->', action.sink_uid);
      return setActionStatus(action, Action.DONE);
    }).catch(function(err) {
      if (err && (err.statusCode === 401 || err.statusCode === 403)) {
        verifyCredentials(btUser);
        return Q.resolve(null);
      } else if (err && err.statusCode === 404) {
        logger.info('Unmute returned 404 for inactive sink_uid',
          action.sink_uid, 'cancelling action.');
        return setActionStatus(action, Action.DEFERRED_TARGET_SUSPENDED);
      } else if (err.statusCode) {
        logger.warn('Error /mutes/users/create', err.statusCode, btUser,
          '-->', action.sink_uid);
        return Q.resolve(null);
      } else {
        logger.error('Error /mutes/users/create', err);
        return Q.resolve(null);
      }
      return Q.resolve(null);
    });
  }));
}

/**
 * Given a BtUser and a subset of that user's pending blocks, check the
 * follow relationship between sourceBtUser and those each sinkUid,
 * and block if there is not an existing follow or block relationship and there
 * is no previous external unblock in the Actions table. Then update the
 * Actions' status as appropriate.
 *
 * @param {BtUser} btUser The user whose Actions we should process.
 * @param {Array.<Action>} actions Actions to process.
 */
function processBlocksForUser(btUser, actions) {
  var sinkUids = _.map(actions, 'sink_uid');
  if (sinkUids.length > 100) {
    logger.error('No more than 100 sinkUids allowed. Given', sinkUids.length);
    return Q.reject('Too many sinkUids');
  }
  logger.debug('Checking follow status', btUser,
    '--???-->', sinkUids.length, 'users');
  return getFriendships(btUser, sinkUids
    ).then(function(friendships) {
      var indexedFriendships = _.indexBy(friendships, 'id_str');
      return checkUnblocks(btUser, indexedFriendships, actions);
    }).catch(function (err) {
      if (err.statusCode === 401 || err.statusCode === 403) {
        verifyCredentials(btUser)
        return Q.resolve(null);
      } else if (err.statusCode) {
        logger.warn('Error /friendships/lookup', err.statusCode, 'for',
          btUser);
        return Q.resolve(null);
      } else {
        logger.error('Error /friendships/lookup', err);
        return Q.resolve(null);
      }
    });
}

/**
 * Look in the Actions table to see if we have seen the source user unblock any
 * of the sink_uids from an external application. If so, we'll want to avoid
 * auto-blocking those sink_uids. We stipulate 'from an external application'
 * because it's fine for a user that was auto-unblocked (e.g via subscriptions)
 * to later be auto-reblocked.
 *
 * After doing the lookup, call cancelOrPerformBlocks with the results, plus the
 * results of the friendships lookup previously made.
 *
 * @param {BtUser} sourceBtUser The user doing the blocking.
 * @param {Object} indexedFriendships A map from sink uids to friendship
 *   objects. Simply passed through to cancelOrPerformBlocks.
 * @param{Array.<Action>} actions The list of actions to be performed or
 *   cancelled.
 */
function checkUnblocks(sourceBtUser, indexedFriendships, actions) {
  var sinkUids = _.map(actions, 'sink_uid');
  // Look for the any previous unblock Action for this sink_uid with
  // status = done, cause = external, and cancel if it exists.
  return Action.findAll({
    where: {
      source_uid: sourceBtUser.uid,
      sink_uid: sinkUids,
      status: Action.DONE,
      cause: [Action.EXTERNAL, Action.BULK_MANUAL_BLOCK],
      type: Action.UNBLOCK
    }
  }).then(function(unblocks) {
    var indexedUnblocks = _.indexBy(unblocks, 'sink_uid');
    return util.slowForEach(actions, 70, function(action) {
      return cancelOrPerformBlock(
        sourceBtUser, indexedFriendships, indexedUnblocks, action);
    });
  }).catch(function(err) {
    logger.error(err);
    return Q.resolve(null);
  });
}

/**
 * After fetching friendships results from the Twitter API, process action
 * and block if appropriate. Otherwise cancel.
 *
 * @param{BtUser} sourceBtUser The user doing the blocking.
 * @param{Object} indexedFriendships A map from sink uids to friendship objects
 *   as returned by the Twitter API.
 * @param{Object} indexedUnblocks A map from sink uids to previous unblock
 *   action, if present.
 * @param{Array.<Action>} action An action to be performed or cancelled.
 * @return{Promise.<Action>}
 */
function cancelOrPerformBlock(sourceBtUser, indexedFriendships, indexedUnblocks, action) {
  // Sanity check that this is a block, not some other action.
  if (action.type != Action.BLOCK) {
    return Q.reject("Shouldn't happen: non-block action " + sourceBtUser);
  }
  var sink_uid = action.sink_uid;
  var friendship = indexedFriendships[sink_uid];
  // Decide which state to transition the Action into, if it's not going to be
  // executed.
  var newState = null;

  // If no friendship for this action was returned by /1.1/users/lookup,
  // that means the sink_uid was suspened or deactivated, so defer the Action.
  if (!friendship) {
    newState = Action.DEFERRED_TARGET_SUSPENDED;
  } else if (_.contains(friendship.connections, 'blocking')) {
    // If the sourceBtUser already blocks them, don't re-block.
    newState = Action.CANCELLED_DUPLICATE;
  } else if (_.contains(friendship.connections, 'following')) {
    // If the sourceBtUser follows them, don't block.
    newState = Action.CANCELLED_FOLLOWING;
  } else if (sourceBtUser.uid === sink_uid) {
    // You cannot block yourself.
    newState = Action.CANCELLED_SELF;
  } else if (indexedUnblocks[sink_uid]) {
    // If the user unblocked the sink_uid in the past, don't re-block.
    newState = Action.CANCELLED_UNBLOCKED;
  }
  // If we're cancelling, update the state of the action.
  if (newState) {
    return setActionStatus(action, newState);
  } else {
    // No obstacles to blocking the sink_uid have been found, block 'em!
    logger.debug('Creating block', sourceBtUser.screen_name,
      '--block-->', friendship.screen_name, sink_uid);
    return doBlock(sourceBtUser, sink_uid
      ).then(function(blockResult) {
        logger.info('Blocked ', sourceBtUser.screen_name, sourceBtUser.uid,
          '--block-->', blockResult.screen_name, blockResult.id_str);
        return setActionStatus(action, Action.DONE);
      }).catch(function(err) {
        stats.actionsFinished.labels(action.typeNum, "error").inc();
        if (err && (err.statusCode === 401 || err.statusCode === 403)) {
          verifyCredentials(sourceBtUser);
          return Q.resolve(null);
        } else if (err.statusCode) {
          logger.warn('Error /blocks/create', err.statusCode,
            sourceBtUser.screen_name, sourceBtUser.uid,
            '--block-->', friendship.screen_name, friendship.id_str);
          return Q.resolve(null);
        } else {
          logger.error('Error /blocks/create', err);
          return Q.resolve(null);
        }
      });
  }
}

/**
 * Set an action's status to newState.
 * @param {Action} action Action to modify.
 * @param {string} newState The new state to assign to it.
 * @return {Promise.<Action>} A promise resolved on saving.
 */
function setActionStatus(action, newState) {
  logger.debug('Action', action.id, action.source_uid, action.type,
    action.sink_uid, 'changing to state', newState);
  stats.actionsFinished.labels(action.typeNum, newState).inc();
  action.status = newState;
  return action.save();
}

module.exports = {
  cancelUnsubscribed: cancelUnsubscribed,
  queueActions: queueActions,
  processActionsForUser: processActionsForUser
};

if (require.main === module) {
  setup.statsServer(6441);
  processActions();
  setInterval(processActions, processingIntervalSeconds * 1000);
}
})();
