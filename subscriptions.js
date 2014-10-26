'use strict';
(function() {
var Promise = require('q'),
    _ = require('sequelize').Utils._,
    setup = require('./setup');

var logger = setup.logger,
    Action = setup.Action,
    Subscription = setup.Subscription;

/**
 * Given a block or unblock action with cause = external, enqueue a
 * corresponding action for all subscribers, with cause = subscription.
 *
 * TODO: This is currently only called for external actions. Bulk manual
 * unblocks (from /my-blocks) should also trigger fanout.
 *
 * @param {Action} An Action to fan out to subscribers.
 * @returns {Promise<Action[]>}
 */
function fanout(inputAction) {
  if (inputAction &&
      inputAction.cause === Action.EXTERNAL &&
      (inputAction.type === Action.BLOCK ||
       inputAction.type === Action.UNBLOCK)) {
    Subscription.findAll({
      where: {
        author_uid: inputAction.source_uid
      }
    }).then(function(subscriptions) {
      if (subscriptions && subscriptions.length > 0) {
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
          return Promise.all(actions.map(unblockFromSubscription));
        }
      } else {
        return [];
      }
    }).catch(function(err) {
      logger.error(err);
    })
  } else {
    logger.error('Bad argument to fanout:', inputAction);
    return [];
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
  Action.find({
    where: {
      type: Action.BLOCK,
      source_uid: proposedUnblock.source_uid,
      sink_uid: proposedUnblock.sink_uid,
      status: Action.DONE
    },
    order: 'updatedAt DESC'
  }).then(function(prevAction) {
    if (!prevAction) {
      logger.debug('Subscription-unblock: no previous unblock found', logInfo);
    } else if (prevAction.cause_uid === proposedUnblock.cause_uid &&
      _.contains(validCauses, prevAction.cause)) {
      return Action.create(proposedUnblock);
    } else {
      logger.debug('Subscription-unblock: previous block not matched', logInfo);
    }
  }).catch(function(err) {
    logger.error(err);
  });
}

module.exports = {
  fanout: fanout,
}

})();
