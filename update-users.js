'use strict';
(function() {
/** @type{SetupModule} */
var setup = require('./setup');
var _ = require('sequelize').Utils._;

var config = setup.config,
    twitter = setup.twitter,
    logger = setup.logger,
    sequelize = setup.sequelize,
    accessToken = config.defaultAccessToken,
    accessTokenSecret = config.defaultAccessTokenSecret,
    BtUser = setup.BtUser,
    TwitterUser = setup.TwitterUser,
    BlockBatch = setup.BlockBatch,
    Block = setup.Block;

/**
 * Find TwitterUsers needing update, look them up on Twitter, and store in
 * database. A user needs update if it's just been inserted (no screen name)
 * or if it hasn't been updated in a day.
 *
 * @param {string} sqlFilter An SQL `where' clause to filter users by. Allows
 *   running separate update cycles for fresh users (with no screen name) vs
 *   users who need a refresh.
 */
function findAndUpdateUsers(sqlFilter) {
  TwitterUser
    .findAll({
      where: sequelize.and(
        { deactivatedAt: null },
        sqlFilter),
      limit: 100
    }).error(function(err) {
      logger.error(err);
    }).success(function(users) {
      if (users.length > 0) {
        updateUsers(_.pluck(users, 'uid'));
      }
    });
}

/**
 * Find deactivated BtUsers and re-verify their credentials to see if they've
 * been reactivated.
 */
function reactivateBtUsers() {
  BtUser
    .findAll({
      where: 'deactivatedAt is not null'
    }).error(function(err) {
      logger.error(err);
    }).success(function(btUsers) {
      btUsers.forEach(function (btUser) {
        btUser.verifyCredentials();
      });
    });
}

/**
 * Mark the given TwitterUser deactivated (i.e. suspended, deactivated, or
 * deleted). Note this is slightly different from deactivation of BtUsers
 * because it doesn't include revocation.
 *
 * TODO: Periodically scan deactivated TwitterUsers for reactivation. This is a
 * little trickier than reactivateBtUsers because we expect to have a much
 * larger number of these, enough that we're likely to run into issues with
 * number of outstanding requests and rate limits. One possible approach:
 * have a fast scan for recently-deactivated TwitterUsers and a slow scan for
 * older ones. The slow scan can use offset/limit to iterate through the users.
 *
 * @param {string} uid User to delete.
 */
function deactivateTwitterUser(uid) {
  TwitterUser.find(uid).error(function(err) {
    logger.error(err);
  }).success(function(twitterUser) {
    twitterUser.deactivatedAt = new Date();
    twitterUser.save().error(function(err) {
      logger.error(err);
    }).success(function(twitterUser) {
      logger.debug('Deactivated user', twitterUser.screen_name, uid);
    });
  });
}


/**
 * Given a list of uids, look them up using the Twitter API and update the
 * database accordingly.
 * @param {Array.<string>} uids List of user ids to look up.
 */
function updateUsers(uids) {
  twitter.users('lookup', {
      skip_status: 1,
      user_id: uids.join(',')
    },
    accessToken, accessTokenSecret,
    updateUsersCallback.bind(null, uids));
}

/**
 * Given a user lookup API response from Twitter, store the user into the DB.
 * @param {Array.<string>} uids Array of uids that were requested.
 * @param {Object} err Error return by Twitter API, if any.
 * @param {Array.<Object>} response List of JSON User objects as defined by the
 *   Twitter API. https://dev.twitter.com/docs/platform-objects/users
 */
function updateUsersCallback(uids, err, response) {
  if (err) {
    if (err.statusCode === 429) {
      logger.info('Rate limited.');
    } else if (err.statusCode === 404) {
      // When none of the users in a lookup are available (i.e. they are all
      // suspended or deleted), Twitter returns 404. Delete all of them.
      logger.warn('Twitter returned 404 to /users/lookup, deactivating',
        uids.length, 'users');
      uids.forEach(deactivateTwitterUser);
    } else {
      logger.error('Error /users/lookup', err.statusCode, err.data);
    }
    return;
  }
  logger.info('Got /users/lookup response size', response.length,
    'for', uids.length, 'uids');

  // When a user is suspended, deactivated, or deleted, Twitter will simply not
  // return that user object in the response. Delete those users so they don't
  // clog future lookup attempts.
  var indexedResponses = _.indexBy(response, 'id_str');
  uids.forEach(function(uid) {
    if (indexedResponses[uid]) {
      storeUser(indexedResponses[uid]);
    } else {
      logger.warn('Did not find uid', uid, 'probably suspended. Deleting.');
      deactivateTwitterUser(uid);
    }
  });
}

/**
 * Store a single user into the DB. If the user was marked deactivated,
 * reactivate them.
 * @param {Object} twitterUserResponse A JSON User object as defined by the
 *   Twitter API. https://dev.twitter.com/docs/platform-objects/users
 */
function storeUser(twitterUserResponse) {
  TwitterUser
    .findOrCreate({ uid: twitterUserResponse.id_str })
    .error(function(err) {
      logger.error(err);
    }).success(function(user, created) {
      _.assign(user, twitterUserResponse);
      // This field is special because it needs to be parsed as a date, and
      // because the default name 'created_at' is too confusing alongside
      // Sequelize's built-in createdAt.
      user.account_created_at = new Date(twitterUserResponse.created_at);
      user.deactivatedAt = null;
      // In general we want to write the user to DB so updatedAt gets bumped,
      // so we know not to bother refreshing the user for a day. However, during
      // startup of stream.js when we replay recent mentions, we receive a lot
      // of 'incidental' user objects. We don't want to flood the TwitterUsers
      // DB with writes during startup, so we skip writing to the DB if the user
      // was updated in the last 5 seconds.
      if (user.changed() || (new Date() - user.updatedAt) > 5000 /* ms */) {
        user.save()
          .error(function(err) {
            logger.error(err);
          }).success(function(user) {
            if (created) {
              logger.debug('Created user', user.screen_name, user.id_str);
            } else {
              logger.debug('Updated user', user.screen_name, user.id_str);
            }
          });
      } else {
        logger.debug('Skipping update for', user.screen_name, user.id_str);
      }
    });
}

module.exports = {
  findAndUpdateUsers: findAndUpdateUsers,
  storeUser: storeUser
};

if (require.main === module) {
  findAndUpdateUsers();
  // Poll for just-added users every 1 second and do an initial fetch of their
  // information.
  setInterval(findAndUpdateUsers.bind(null, 'screen_name IS NULL'), 5000);
  // Poll for users needing update every 10 seconds.
  setInterval(
    findAndUpdateUsers.bind(null, 'updatedAt < (now() - INTERVAL 1 DAY)'), 10000);
  // Poll for reactivated users every hour.
  setInterval(reactivateBtUsers, 60 * 60 * 1000);
}
})();
