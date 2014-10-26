'use strict';
(function() {
var twitterAPI = require('node-twitter-api'),
    fs = require('fs'),
    Promise = require('q'),
    /** @type{Function|null} */ timeago = require('timeago'),
    _ = require('sequelize').Utils._,
    setup = require('./setup'),
    updateUsers = require('./update-users');

var twitter = setup.twitter,
    logger = setup.logger,
    Action = setup.Action,
    Block = setup.Block,
    BtUser = setup.BtUser,
    TwitterUser = setup.TwitterUser,
    Subscription = setup.Subscription,
    SharedBlock = setup.SharedBlock;

/**
 * Given a block action with cause = external, enqueue a corresponding block
 * action for all subscribers.
 *
 * TODO: Unblocks should not fanout to users that are subscribed to other block
 * lists which still contain the account to be unblocked.
 *
 * TODO: This is currently only called for external blocks. Bulk manual
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
 * @param {Object} JSON representing an Action to possibly enqueue.
 */
function unblockFromSubscription(proposedUnblock) {
  var validCauses = [Action.SUBSCRIPTION, Action.BULK_MANUAL_BLOCK];
  var logInfo = proposedUnblock.source_uid + ' --unblock--> ' +
    proposedUnblock.sink_uid;
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
