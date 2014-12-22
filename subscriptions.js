'use strict';
(function() {
var Q = require('q'),
    _ = require('sequelize').Utils._,
    setup = require('./setup');

var logger = setup.logger,
    Action = setup.Action,
    Subscription = setup.Subscription;

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
  Action.find({
    where: {
      type: Action.BLOCK,
      source_uid: proposedUnblock.source_uid,
      sink_uid: proposedUnblock.sink_uid,
      status: [Action.DONE, Action.PENDING]
    },
    order: 'updatedAt DESC'
  }).then(function(prevAction) {
    if (!prevAction) {
      logger.debug('Subscription-unblock: no previous block found', logInfo);
    } else if (prevAction.cause_uid === proposedUnblock.cause_uid &&
      _.contains(validCauses, prevAction.cause)) {
      // TODO: Use actions.queueActions here.
      return Action.create(proposedUnblock);
    } else {
      logger.debug('Subscription-unblock: previous block not matched', logInfo);
    }
  }).catch(function(err) {
    logger.error(err);
  });
}

module.exports = {
  fanoutActions: fanoutActions,
}

})();
