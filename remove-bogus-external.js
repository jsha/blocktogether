'use strict';
/**
 * Script to clean up Actions incorrectly marked as 'external'.
 * A bug in how we record actions
 * (https://github.com/jsha/blocktogether/issues/178) led to a large number of
 * duplicate actions being recorded in the DB as 'external'. The expected case
 * from the bug was that we would execute a subscription block or auto-block,
 * then sometime later observe that block and treat it as a new one. However,
 * this script also catches a number of duplicate blocks caused by users
 * deactivating and reactivating (see
 * https://github.com/jsha/blocktogether/issues/180).
 */
var Q = require('q'),
    util = require('./util'),
    setup = require('./setup');

var BtUser = setup.BtUser;

BtUser
  .findAll({
  }).then(function(users) {
    util.slowForEach(users, 2000, function(user) {
      // Go from oldest actions to newest actions.
      user.getActions({
        order: 'updatedAt ASC'
      }).then(function(actions) {
        var hash = {};
        actions.forEach(function(action) {
          // We don't care about anything except blocks and unblocks.
          if (action.type !== Action.BLOCK && action.type !== Action.UNBLOCK) {
            return;
          }
          // If we find an external action where there was a previous action for
          // the same sink_uid, and that action has the same type, delete this
          // external action. This will catch incorrect 'external' actions
          // (https://github.com/jsha/blocktogether/issues/178) as well as
          // duplicate block actions triggered by users deactivating and
          // reactivating.
          if (action.cause === Action.EXTERNAL &&
              hash[action.sink_uid] &&
              hash[action.sink_uid].type === action.type) {
            process.stdout.write('destroying ' + action.id + ' bc ' + hash[action.sink_uid].id + '\n');
            action.destroy();
          }
          hash[action.sink_uid] = action;
        });
      });
    });
  }).catch(function(err) {
    process.stderr.write(err);
  });
