'use strict';
var Q = require('q'),
    _ = require('lodash'),
    setup = require('./setup'),
    actionsModule = require('./actions'),
    updateUsers = require('./update-users');

var logger = setup.logger,
    Action = setup.Action,
    Block = setup.Block,
    BlockBatch = setup.BlockBatch,
    BtUser = setup.BtUser,
    Subscription = setup.Subscription,
    remoteUpdateBlocks = setup.remoteUpdateBlocks;

/**
 * Given a set of actions that were observed by update-blocks and recorded as
 * external actions (i.e. the user blocked or unblocked some accounts using
 * Twitter for Web or some other client), fanout those actions to subscribers,
 * i.e. add entries in the Action table for each subscriber with source_uid =
 * that subscriber and cause = 'Subscription'.
 *
 * We look up the list of subscribers first so we can exit fast in the common
 * case that someone has no subscribers.
 *
 * @param {Array.<Action>} actions Block or unblock actions to fan out. May be
 *   null. All must have the same source_uid and cause == 'external'.
 * @return {Promise.<>} Promise that resolves once fanout is done. Type of
 *   promise is not defined (TODO: make it consistent).
 */
function fanoutActions(actions) {
  actions = _.filter(actions, null);
  if (actions.length === 0) {
    logger.debug('fanoutActions called with all null actions, skipping.');
    return Q.resolve([]);
  }
  var source_uids = Object.keys(_.keyBy(actions, 'source_uid'));
  if (source_uids.length > 1) {
    return Q.reject('Bad arg to fanoutActions: multiple sources:', actions);
  }
  if (!_.every(actions, { cause: Action.EXTERNAL })) {
    return Q.reject('Bad arg to fanoutActions: not external:', actions);
  }
  if (!_.every(actions, function(action) {
    return action.type == Action.BLOCK || action.type === Action.UNBLOCK;
  })) {
    return Q.reject('Bad arg to fanoutActions: not block/unblock:', actions);
  }

  // Look up the relevant subscriptions once, then use that list of subscriptions
  // when fanning out each individual action. We may want at some point to just
  // directly do the N * M expansion and do one big bulkCreate, but that
  // requires that we simplify how unblocks work. For now we just save the
  // duplicate lookups in the Subscriptions table (especially useful when there
  // are no subscriptions).
  return Subscription.findAll({
    where: {
      author_uid: source_uids[0]
    }
  }).then(async function(subscriptions) {
    if (subscriptions && subscriptions.length > 0) {
      logger.info('Fanning out', actions.length, 'actions from',
        source_uids[0], 'to', subscriptions.length, 'subscribers.');
      let result = [];
      for (let action of actions) {
        result.push(await fanoutWithSubscriptions(action, subscriptions));
      }
      return result;
    } else {
      return Q.resolve([]);
    }
  }).catch(function(err) {
    logger.error(err);
  });
}

/**
 * Given a block or unblock action with cause = external, enqueue a
 * corresponding action for all subscribers, with cause = subscription.
 *
 * TODO: This is currently only called for external actions. Bulk manual
 * unblocks (from /my-blocks) should also trigger fanout.
 *
 * @param {Action} An Action to fan out to subscribers.
 * @return {Promise.<Action[]>}
 */
function fanoutWithSubscriptions(inputAction, subscriptions) {
  logger.info("fanoutWithSubscriptions", inputAction.source_uid,
    "to", subscriptions.length, "subscribers");
  var actions = subscriptions.map(function(subscription) {
    return {
      source_uid: subscription.subscriber_uid,
      sink_uid: inputAction.sink_uid,
      type: inputAction.type,
      cause: Action.SUBSCRIPTION,
      cause_uid: inputAction.source_uid,
      'status': Action.PENDING
    };
  });
  // Create all the corresponding Block (or Unblock) Actions. Users who
  // have a previous manual unblock of the sink_uid (and therefore shouldn't
  // auto-block) will be handled inside actions.js.
  // TODO: This should probably use actions.queueActions to automatically set
  // pendingActions = true. But that function doesn't support queuing multiple
  // actions from different source_uids.
  return Action.bulkCreate(actions).then(async function(actions) {
    let subscriber_uids = _.map(subscriptions, 'subscriber_uid');
    let subscribers = BtUser.findAll({
      where: {
        uid: subscriber_uids
      }
    });
    await Q.all(subscribers.map(function(subscriber) {
      subscriber.pendingActions = true;
      return subscriber.save();
    }));
    return null;
  });
}

/**
 * Get a list of all the blocks for uid from their latest complete BlockBatch.
 * @return {Promise.<Array.<Block> >} a list of blocks.
 */
function getLatestBlocks(uid) {
  logger.debug('Getting latest blocks for', uid);
  return BlockBatch.findOne({
    where: {
      source_uid: uid,
      complete: true
    },
    order: [['updatedAt', 'desc']]
  }).then(function(blockBatch) {
    if (blockBatch) {
      return Block.findAll({
        where: {
          blockBatchId: blockBatch.id
        }
      });
    } else {
      return Q.reject('No blockBatch available for', uid);
    }
  });
}

/**
 * For a given uid, return an Object whose keys are the uids of all accounts
 * that user has ever unblocked (auto-unblocks from subscriptions do not
 * count). The values of the object are single Actions demonstrating the
 * unblock. If the user unblocked an account multiple times, only one Action is
 * included, and it is not guaranteed to be the latest.
 * @param {string} uid User id whose Actions to look at.
 * @return {Promise.<Object>} Object mapping uid -> unblock Actions.
 */
function getManualUnblocks(uid) {
  return Action.findAll({
    where: {
      type: Action.UNBLOCK,
      source_uid: uid,
      status: Action.DONE,
      cause: [Action.EXTERNAL, Action.BULK_MANUAL_BLOCK]
    }
  }).then(function(actions) {
    return _.keyBy(actions, 'sink_uid');
  });
}

/**
 * For a given user, find all their subscriptions, and all the accounts
 * included on those subscription block lists. Return an object mapping from
 * blocked account uid -> list of authors blocking that user.
 * User must have its subscriptions field populated.
 * @param {BtUser} user
 * @return {Object}
 */
function subscriptionBlocksAuthors(user) {
  var subscriptions = user.Subscriptions;
  if (!subscriptions && subscriptions.length === 0) {
    logger.error('No subscriptions for', user);
    return {};
  }

  var authors = _.map(subscriptions, 'author_uid');
  logger.info('User', user, 'subscribes to', authors.join(', '));
  return Q.all(authors.map(getLatestBlocks))
    .then(function(blocklists) {
    // Create a mapping from a sink_uid (i.e. a blocked account) to a list
    // of subscribed author_uids who have that sink_uid blocked.
    var blocksAuthors = {};
    _.zip(authors, blocklists).forEach(function(pair) {
      var author_uid = pair[0];
      var blocklist = pair[1];
      blocklist.forEach(function(block) {
        var sink_uid = block.sink_uid;
        if (!blocksAuthors[sink_uid]) {
          blocksAuthors[sink_uid] = [author_uid];
        } else {
          blocksAuthors[sink_uid].push(author_uid);
        }
      });
    });
    return blocksAuthors;
  });
}

/**
 * Given an object, delete all keys listed in array.
 * @param {Object} obj Object to be deleted from.
 * @param {Array} array Array whose entries should be used as keys to delete.
 */
function deleteFromObject(obj, array) {
  array.forEach(function(item) {
    delete obj[item];
  });
}

/**
 * Do a subscription fixup: Block any accounts that need blocking, unblock
 * any that need unblocking, etc. Check that user is ready (no pending actions),
 * and update blocks before proceeding.
 * @param {string} uid
 */
function fixUp(uid) {
  return BtUser.findOne({
    where: {
      uid: uid
    },
    include: [{
      model: Subscription,
      as: 'Subscriptions'
    }]
  }).then(function(user) {
    return [user, Action.count({
      where: {
        source_uid: user.uid,
        status: Action.PENDING
      }
    })];
  }).spread(function(user, pendingActionsCount) {
    if (user.deactivatedAt !== null) {
      logger.info('No fixup for', user, 'because deactivated.');
      return null;
    } else if (user.Subscriptions.length === 0) {
      logger.info('No fixup for', user, 'because no subscriptions.');
      return null;
    } else if (pendingActionsCount > 0) {
      logger.info('No fixup for', user, 'because actions are pending.');
      return null;
    } else {
      return [user, remoteUpdateBlocks(user)];
    }
  }).spread(function(user, blocks) {
    fixUpReadyUser(user);
  }).catch(function(err) {
    logger.error(err);
  });
}

/**
 * Given a user that is ready (no pending actions; blocks just updated),
 * do a subscription fixup: Block any accounts that need blocking, unblock
 * any that need unblocking, etc.
 * NOTE: Currently doesn't actually enqueue any actions, just logs actions that
 * need to be taken.
 * TODO: Is there a bug with fanoutActions when a block diff is very large, like
 * 5000 new blocks?
 * @param {BtUser} user
 */
function fixUpReadyUser(user) {
  var subscriptionBlocksAuthorsPromise = subscriptionBlocksAuthors(user);
  var blocksPromise = getLatestBlocks(user.uid);
  var unblocksPromise = getManualUnblocks(user.uid);

  Q.spread([subscriptionBlocksAuthorsPromise, blocksPromise, unblocksPromise],
    function(blocksAuthors, blocks, unblocks) {
      logger.info('User', user, 'currently blocks', blocks.length,
        'accounts, has', Object.keys(blocksAuthors).length,
        'accounts in all block lists.')

      // Take all the sink_uids that show up in the union of subscribed block
      // lists, the remove the ones already blocked and the ones previously
      // unblocked manually. What's left is who we should block.
      var toBeBlocked = _.clone(blocksAuthors);
      var currentlyBlocked = _.keyBy(blocks, 'sink_uid');
      deleteFromObject(toBeBlocked, Object.keys(currentlyBlocked));
      deleteFromObject(toBeBlocked, Object.keys(unblocks));
      // Don't try to block self.
      deleteFromObject(toBeBlocked, [user.uid]);
      // TODO: Check remaining uids in users db to see if they are suspended,
      // and delete those that are.
      var toBeBlockedUids = Object.keys(toBeBlocked);
      logger.info('User', user, 'should maybe block', toBeBlockedUids.length,
        'accounts for subscriptions:\n', toBeBlockedUids.join("\n"));
      updateUsers.updateUsers(toBeBlockedUids).then(function(uidMap) {
        var actuallyFound = Object.keys(uidMap);
        // TODO: Actually enqueue blocks for these users.
        logger.info('User', user, 'will block', actuallyFound.length,
          'accounts for subscriptions:\n', actuallyFound.join("\n"));
        // We need to attribute a cause_uid for each action. In the typical
        // case, each sink_uid is caused by a single author. But it is possible
        // that multiple subscribed authors have the same sink_uid on their
        // block lists. So we look at the mapping from sink_uid to <list of
        // authors who block that sink_uid>, and pick the first one.
        if (process.env['DO_IT']) {
          actuallyFound.forEach(function(sink_uid) {
            var authors = blocksAuthors[sink_uid];
            if (authors && authors.length >= 1) {
              actionsModule.queueActions(user.uid, [sink_uid],
                Action.BLOCK, Action.SUBSCRIPTION,
                authors[0]);
            } else {
              // This should be impossible, because the sink_uid shouldn't wind up
              // in the toBeBlocked map unless there are some subscribed authors
              // blocking that sink_uid.
              logger.error('Could not find author who blocks', sink_uid);
            }
          });
        }
      });

      // Unblocks section
      // TODO: Refactor this to use Annotated Blocks.
      // TODO: Move this into a separate function.
      // TODO: This allows us to obsolete the fragile unblockFromSubscription.
      // Instead we can just make sure to do a fixup for each
      // user each day, and let all the unblocking happenin the fixup code. This
      // means unblock fanouts will be slow, but that is fine. Only block
      // fanouts need to be fast.

      return user.getActions({
        where: {
          // Important: Do not add additional clauses here. We want to get all
          // of the relevent block/unblock options, then stack them up and take
          // the most recent, and only *then* filter out actions we don't care
          // about. That way we always judge by the most recent action.
          'status': Action.DONE,
          type: [Action.BLOCK, Action.UNBLOCK]
        },
        order: [['updatedAt', 'asc']]
      }).then(function(actions) {
        // keyBy will overwrite earlier entries with later ones, so for each
        // action we get the most recent one. Use this to get a list of actions
        // where each action is only the most recent for that sink_uid.
        var uniquedActions = _.values(_.keyBy(actions, 'sink_uid'));
        var currentlySubscribed = _.keyBy(user.Subscriptions, 'author_uid');
        var actionsToReverse = _.filter(uniquedActions, function(action) {
          var sink_uid = action.sink_uid;
          // We only care about blocks, and only blocks caused by a subscription
          // to an author that the user currently still subscribes to.
          // Also we ignore any block actions where the sink_uid is not listed
          // as currently blocked. This happens when a sink_uid is
          // suspended, deactivated, or deleted.
          return action.type === Action.BLOCK &&
                 (action.cause === Action.SUBSCRIPTION ||
                  action.cause === Action.BULK_MANUAL_BLOCK) &&
                 currentlySubscribed[action.cause_uid] &&
                 currentlyBlocked[sink_uid] &&
                 // Also ignore any actions whose sink_uid is in the union of
                 // currently subscribed block lists. Such accounts should
                 // stay blocked.
                 !blocksAuthors[sink_uid];
        });
        // If there's anything left after those filters, it's a block action and
        // we should unblock.
        var toBeUnblockedUids = _.map(actionsToReverse, 'sink_uid');
        logger.info('User', user, 'should unblock', toBeUnblockedUids.length,
          'accounts for subscriptions:\n', toBeUnblockedUids.join("\n"));
        if (process.env['DO_IT']) {
          actionsToReverse.forEach(function(action) {
            actionsModule.queueActions(user.uid, [action.sink_uid],
              Action.UNBLOCK, Action.SUBSCRIPTION,
              action.cause_uid);
            });
        }
        setup.gracefulShutdown();
      });
    }).catch(function(err) {
      logger.error(err);
    });
}

if (require.main === module) {
  fixUp(process.argv[2]);
}

module.exports = {
  fanoutActions: fanoutActions,
}
