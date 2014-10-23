'use strict';
(function() {
var twitterAPI = require('node-twitter-api'),
    fs = require('fs'),
    Promise = require('promise'),
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

  Promise.all([
    subscribedBlocksPromise, currentBlocksPromise, blockActionsPromise])
    .then(function(results) {
      finishSubscriptionsForUser(user, results[0], results[1], results[2]);
    }).catch(function(err) {
      logger.error(err);
    });
}

function finishSubscriptionsForUser(
  user, subscribedBlocks, currentBlocks, blockActions) {
  logger.info('SubscribedBlocks: ', _.pluck(subscribedBlocks, 'dataValues'));
  logger.info('CurrentBlocks: ', _.pluck(currentBlocks, 'dataValues'));
  logger.info('BlockActions: ', _.pluck(blockActions, 'dataValues'));
}

BtUser.find({screen_name: 'twestact4'}).then(fulfillSubscriptionsForUser);

})();
