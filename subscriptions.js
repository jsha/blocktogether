'use strict';
(function() {
var Q = require('q'),
    _ = require('sequelize').Utils._,
    setup = require('./setup');

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
  var source_uids = Object.keys(_.indexBy(actions, 'source_uid'));
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
  }).then(function(subscriptions) {
    if (subscriptions && subscriptions.length > 0) {
      logger.info('Fanning out', actions.length, 'actions from',
        source_uids[0], 'to', subscriptions.length, 'subscribers.');
      return actions.map(function(action) {
        return fanoutWithSubscriptions(action, subscriptions);
      });
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
  // For Block Actions, fanout is very simple: Just create all the
  // corresponding Block Actions. Users who have a previous manual unblock
  // of the sink_uid (and therefore shouldn't auto-block) will be handled
  // inside actions.js.
  if (inputAction.type === Action.BLOCK) {
    // TODO: This should probably use actions.queueActions to take advantage of
    // its instant kickoff of a processing run. But right now that run would
    // take place in-process, adding extra work for update-blocks.js, which is
    // already a CPU bottleneck.
    return Action.bulkCreate(actions);
  } else {
    // For Unblock Actions, we only want to fan out the unblock to users
    // who originally blocked the given user due to a subscription.
    // Pass each Action through unblockFromSubscription to check the cause
    // of the most recent corresponding block, if any.
    // TODO: Maybe the filtering logic to only do unblocks that were
    // originally due to a subscription should be handled in actions.js. That
    // would be nice because actions.js can deal with things asynchronously
    // and slow down gracefully under load, but subscription fanout has to
    // happen in the already-complicated updateBlocks call chain.
    return Q.all(actions.map(unblockFromSubscription));
  }
}

/**
 * Given a subscription-based Unblock that we are about to enqueue, first check
 * that the most recent Block of that account had cause:
 * subscription | bulk-manual-block, and cause_uid = the cause_uid of the
 * unblock we are about to enqueue.
 *
 * TODO: Unblocks should also not fanout to users that are subscribed to other
 * block lists which still contain the account to be unblocked.
 *
 * @param {Object} JSON representing an Action to possibly enqueue.
 */
function unblockFromSubscription(proposedUnblock) {
  var validCauses = [Action.SUBSCRIPTION, Action.BULK_MANUAL_BLOCK];
  var logInfo = proposedUnblock.source_uid + ' --unblock--> ' +
    proposedUnblock.sink_uid;
  // The separation between which properties get put in the where clause, versus
  // which ones get checked in the `if' statement below, is a little subtle.
  // We want to make sure we look at the most recent block, even if it doesn't
  // match on cause_uid, because we specifically want to notice the case where
  // the most recent block was manual.
  return Action.find({
    where: {
      type: Action.BLOCK,
      source_uid: proposedUnblock.source_uid,
      sink_uid: proposedUnblock.sink_uid,
      // NOTE: Intuitively Action.PENDING should be included here: If an author
      // blocks an account, then unblocks it immediately while the fanned-out
      // actions are still pending, the unblocks should also fanout.
      // HOWEVER, that would mean that if subscriber S independently has account
      // T blocked, then an author they subscribe to could very quickly block
      // and unblock T, which would cause an unblock of T on the subscriber's
      // account. This is probably an argument of 'enqueue it all and sort it
      // out when executing actions.'
      status: Action.DONE
    },
    order: 'updatedAt DESC'
  }).then(function(prevAction) {
    // All three of these cases are normal and expected: the user never blocked
    // the target; the user did block the target due to a subscription, and the
    // author of the subscribed list unblocked; the user did block the target,
    // but not because of a subscription.
    if (!prevAction) {
      logger.debug('Subscription-unblock: no previous block found', logInfo);
    } else if (prevAction.cause_uid === proposedUnblock.cause_uid &&
               _.contains(validCauses, prevAction.cause)) {
      // TODO: Use actions.queueActions here.
      return Action.create(proposedUnblock);
    } else {
      logger.debug('Subscription-unblock: previous block not matched', logInfo);
      return Q.resolve(null);
    }
  }).catch(function(err) {
    logger.error(err);
    return Q.resolve(null);
  });
}

/**
 * Get a list of all the blocks for uid from their latest complete BlockBatch.
 * @return {Promise.<Array.<Block> >} a list of blocks.
 */
function getLatestBlocks(uid) {
  logger.debug('Getting latest blocks for', uid);
  return BlockBatch.find({
    where: {
      source_uid: uid,
      complete: true
    },
    order: 'updatedAt desc'
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
  return Action.find({
    where: {
      type: Action.UNBLOCK,
      source_uid: uid,
      cause: {
        not: [Action.SUBSCRIPTION]
      }
    }
  }).then(function(actions) {
    return _.indexBy(actions, 'sink_uid');
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
  var subscriptions = user.subscriptions;
  if (!subscriptions && subscriptions.length === 0) {
    logger.error('No subscriptions for', user);
    return {};
  }

  var authors = _.pluck(subscriptions, 'author_uid');
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
  return BtUser.find({
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
    } else if (user.subscriptions.length === 0) {
      logger.info('No fixup for', user, 'because no subscriptions.');
      return null;
    } else if (pendingActionsCount > 0) {
      logger.info('No fixup for', user, 'because actions are pending.');
      return null;
    } else {
      return [user, remoteUpdateBlocks(user)];
    }
  }).spread(function(user, blocks) {
    if (blocks) {
      return fixUpReadyUser(user);
    } else {
      return null;
    }
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
      var currentlyBlocked = _.indexBy(blocks, 'sink_uid');
      deleteFromObject(toBeBlocked, Object.keys(currentlyBlocked));
      deleteFromObject(toBeBlocked, Object.keys(unblocks));
      // Don't try to block self.
      deleteFromObject(toBeBlocked, [user.uid]);
      // TODO: Check remaining uids in users db to see if they are suspended,
      // and delete those that are.
      var toBeBlockedUids = Object.keys(toBeBlocked);
      // TODO: Actually enqueue blocks for these users.
      logger.info('User', user, 'should block', toBeBlockedUids.length,
        'accounts for subscriptions:\n', toBeBlockedUids.join("\n"));

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
        order: 'updatedAt asc'
      }).then(function(actions) {
        // indexBy will overwrite earlier entries with later ones, so for each
        // action we get the most recent one. Use this to get a list of actions
        // where each action is only the most recent for that sink_uid.
        var uniquedActions = _.values(_.indexBy(actions, 'sink_uid'));
        var currentlySubscribed = _.indexBy(user.subscriptions, 'author_uid');
        var actionsToReverse = _.filter(uniquedActions, function(action) {
          var sink_uid = action.sink_uid;
          // We only care about blocks, and only blocks caused by a subscription
          // to an author that we currently still subscribe to.
          // Also we ignore any block actions where the sink_uid is not listed
          // as currently blocked. This happens when a target account is
          // suspended, deactivated, or deleted.
          logger.trace(sink_uid, action.type, action.cause, !!currentlySubscribed[action.cause_uid], !!currentlyBlocked[sink_uid], !blocksAuthors[sink_uid]);
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
        // If there's anything left after those filters, it a block action and
        // we should unblock.
        var toBeUnblockedUids = _.pluck(actionsToReverse, 'sink_uid');
        logger.info('User', user, 'should unblock', toBeUnblockedUids.length,
          'accounts for subscriptions:\n', toBeUnblockedUids.join("\n"));
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

})();
