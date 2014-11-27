'use strict';
(function() {
var Q = require('q'),
    _ = require('sequelize').Utils._,
    setup = require('./setup');

var logger = setup.logger,
    Action = setup.Action,
    AnnotatedBlock = setup.AnnotatedBlock,
    Block = setup.Block,
    Subscription = setup.Subscription;

/**
 * Given a block or unblock action with cause = external, enqueue a
 * corresponding action for all subscribers, with cause = subscription.
 *
 * TODO: This is currently only called for external actions. Bulk manual
 * unblocks (from /my-blocks) should also trigger fanout.
 *
 * @param {Array.<Action>} inputActions Actions to fan out to subscribers.
 * @returns {Promise.<Action[]>}
 */
function fanout(inputActions) {
  var source_uids = _.uniq(_.pluck(inputActions, 'source_uid'));
  if (source_uids.length !== 1) {
    return Q.reject("Source uids on actions for fanout do not match.");
  }
  var source_uid = source_uids[0];
  return Subscription.findAll({
    where: {
      author_uid: source_uid
    }
  }).then(function(subscriptions) {
    if (subscriptions && subscriptions.length > 0) {
      // If there are N subscribers and we are called with M actions, we'll
      // write N*M actions to the DB. Iterate by actions, then by subscriptions
      // within fanoutAction.
      return inputActions.map(fanoutAction.bind(null, subscriptions));
    } else {
      return Q.resolve(null);
    }
  }).catch(function(err) {
    logger.error(err);
  });
}

function fanoutAction(subscriptions, inputAction) {
  if (inputAction.cause === Action.EXTERNAL &&
      (inputAction.type === Action.BLOCK ||
       inputAction.type === Action.UNBLOCK)) {
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
      return Action.bulkCreate(actions);
    } else {
      // For Unblock Actions, we only want to fan out the unblock to users
      // who originally blocked the given user due to a subscription.
      // Pass each Action through unblockFromSubscription to check the cause
      // of the most recent corresponding block, if any.
      return Q.all(actions.map(unblockFromSubscription));
    }
  } else {
    return Q.reject('Bad argument to fanout:' + inputAction);
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
      return Q.resolve(null);
    } else if (prevAction.cause_uid === proposedUnblock.cause_uid &&
               _.contains(validCauses, prevAction.cause)) {
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
 * @param {BtUser} user
 * @return {Object}
 */
function subscriptionBlocksAuthors(user) {
  var subscriptionsPromise = Subscription.findAll({
    where: {
      subscriber_uid: user.uid
    }
  }).then(function(subscriptions) {
    if (subscriptions && subscriptions.length > 0) {
      var authors = _.pluck(subscriptions, 'author_uid');
      return Q.all(authors.map(getLatestBlocks))
        .then(function(blocklists) {
        var authorsBlocklists = _.zip(authors, blocklists);
        // Create a mapping from a sink_uid (i.e. a blocked account) to a list
        // of subscribed author_uids who have that sink_uid blocked.
        var blocksAuthors = {};
        blocksAuthors.forEach(function(pair) {
          var author_uid = pair[0];
          var blocklist = pair[0];
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
    } else {
      logger.debug('No subscriptions for', user);
      return {};
    }
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

function fixUp(user) {
  var subscriptionBlocksAuthorsPromise = subscriptionBlocksAuthors(user);
  var blocksPromise = getLatestBlocks(user.uid);
  var unblocksPromise = getManualUnblocks(user.uid);

  Q.spread([subscriptionBlocksAuthorsPromise, blocksPromise, unblocksPromise],
    function(blocksAuthors, blocks, unblocks) {
      var toBeBlocked = _.clone(blocksAuthors);
      deleteFromObject(toBeBlocked, _.pluck(blocks, 'sink_uid'));
      deleteFromObject(toBeBlocked, Object.keys(unblocks));
      var toBeBlockedUids = Object.keys(toBeBlocked);
      // TODO: Actually enqueue blocks for these users.
      logger.info('User', user, 'should block', toBeBlockedUids.length,
        'accounts for subscriptions:', toBeBlockedUids);

      var toBeUnblocked = _.indexBy(blocks, 'sink_uid');
      deleteFromObject(toBeUnblocked, Object.keys(blocksAuthors));
      // TODO: From the remaining blocks, delete any that don't have cause =
      // Subscription and cause_uid = [one of currently subscribed authors].
      // This will be easiest to do with Annotated Blocks.
    }).catch(function(err) {
      logger.error(err);
    });
}

module.exports = {
  fanout: fanout,
}

})();
