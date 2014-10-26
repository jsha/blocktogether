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
 * @param {Action} An Action to fan out to subscribers.
 * @returns {Promise<Action[]>}
 */
function fanout(action) {
  if (action &&
      action.cause === Action.EXTERNAL) {
    Subscription.findAll({
      where: {
        author_uid: action.source_uid
      }
    }).then(function(subscriptions) {
      if (subscriptions && subscriptions.length > 0) {
        var actions = subscriptions.map(function(subscription) {
          return {
            source_uid: subscription.subscriber_uid,
            sink_uid: action.sink_uid,
            type: action.type,
            cause: Action.SUBSCRIPTION,
            cause_uid: action.source_uid,
            'status': Action.PENDING
          };
        });
        return Action.bulkCreate(actions);
      } else {
        return [];
      }
    }).catch(function(err) {
      logger.error(err);
    })
  } else {
    return [];
  }
}

/**
 * Find a user who hasn't had their blocks updated recently and update them.
 */
function fulfillSubscriptionsForUser(user) {
  var subscribedBlocksPromise = Subscription.findAll({
    where: {
      subscriber_uid: user.uid
    }
  }).then(function(subscriptions) {
    if (subscriptions && subscriptions.length > 0) {
      return SharedBlock.findAll({
        where: {
          author_uid: _.pluck(subscriptions, 'author_uid')
        }
      });
    } else {
      return Promise.resolve([]);
    }
  });

  var currentBlocksPromise = user.getBlockBatches({
    limit: 1,
    order: 'updatedAt desc'
  }).then(function(blockBatch) {
    if (!blockBatch) {
      return Promise.reject('No blocks available for', user);
    } else {
      return Block.findAll({
        where: {
          BlockBatchId: blockBatch.id
        }
      });
    }
  });

  var blockActionsPromise = Action.findAll({
    where: {
      source_uid: user.uid,
      type: Action.UNBLOCK,
      status: Action.DONE,
      cause: [Action.EXTERNAL, Action.BULK_MANUAL_BLOCK],
    }
  });

  Promise.spread([
    subscribedBlocksPromise, currentBlocksPromise, blockActionsPromise],
    finishSubscriptionsForUser)
    .catch(function(err) {
      logger.error(err);
    });
}

function finishSubscriptionsForUser(
  user, subscribedBlocks, currentBlocks, blockActions) {
  logger.info('SubscribedBlocks: ', _.pluck(subscribedBlocks, 'dataValues'));
  logger.info('CurrentBlocks: ', _.pluck(currentBlocks, 'dataValues'));
  logger.info('BlockActions: ', _.pluck(blockActions, 'dataValues'));
}

//BtUser.find({screen_name: 'twestact4'}).then(fulfillSubscriptionsForUser);

module.exports = {
  fanout: fanout,
}

})();
