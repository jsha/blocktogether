var setup = require('./setup'),
    _ = require('sequelize').Utils._;

var config = setup.config,
    twitter = setup.twitter,
    logger = setup.logger,
    accessToken = config.defaultAccessToken,
    accessTokenSecret = config.defaultAccessTokenSecret,
    BtUser = setup.BtUser,
    TwitterUser = setup.TwitterUser,
    BlockBatch = setup.BlockBatch,
    Block = setup.Block;

/**
 * Find uids needing update, look them up on Twitter, and store in database.
 */
function findAndUpdateUsers() {
  TwitterUser
    .findAll({
      where: 'screen_name is null',
      limit: 100
    }).error(function(err) {
      logger.error(err);
    }).success(function(users) {
      if (users.length > 0) {
        var uids = _.pluck(users, 'uid');
        twitter.users('lookup', {
            skip_status: 1,
            user_id: uids.join(',')
          },
          accessToken, accessTokenSecret,
          updateUsers.bind(null, uids));
      }
    });
}

/**
 * Find deactivated BtUsers and re-verify their credentials to see if they've
 * been reactivated.
 */
function reactivateUsers() {
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
 * Delete the user with the given uid.
 * @param {string} uid User to delete.
 */
function deleteUser(uid) {
  TwitterUser.destroy({ uid: uid }).error(function(err) {
    logger.error(err);
  }).success(function() {
    logger.debug('Deleted suspended user', uid);
  });
}

/**
 * Given a user lookup API response from Twitter, store the user into the DB.
 * @param {string[]} uids Array of uids that were requested.
 * @param {Object} err Error return by Twitter API, if any.
 * @param {Object[]} response List of JSON User objects as defined by the
 *   Twitter API. https://dev.twitter.com/docs/platform-objects/users
 */
function updateUsers(uids, err, response) {
  if (err) {
    if (err.statusCode === 429) {
      logger.warn('Rate limited.');
    } else if (err.statusCode === 404) {
      // When none of the users in a lookup are available (i.e. they are all
      // suspended or deleted), Twitter returns 404. Delete all of them.
      logger.warn('Twitter returned 404 to /users/lookup, deleting',
        uids.length, 'users');
      uids.forEach(deleteUser);
    } else {
      logger.error(err);
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
      deleteUser(uid);
    }
  });
}

/**
 * Store a single user into the DB.
 * @param {Object} twitterUserResponse A JSON User object as defined by the
 *   Twitter API. https://dev.twitter.com/docs/platform-objects/users
 */
function storeUser(twitterUserResponse) {
  TwitterUser
    .findOrCreate({ uid: twitterUserResponse.id_str })
    .error(function(err) {
      logger.error(err);
    }).success(function(user, created) {
      user = _.extend(user, twitterUserResponse);
      if (user.changed()) {
        user.save()
          .error(function(err) {
            logger.error(err);
          }).success(function(user) {
            if (created) {
              logger.debug('Created user', user.screen_name);
            } else {
              logger.debug('Updated user', user.screen_name);
            }
          });
      } else {
        logger.debug('User', user.screen_name, 'was unchanged');
      }
    });
}

module.exports = {
  findAndUpdateUsers: findAndUpdateUsers,
  storeUser: storeUser
};

if (require.main === module) {
  findAndUpdateUsers();
  // Poll for more users to update every 2 seconds.
  setInterval(findAndUpdateUsers, 2000);
  // Poll for reactivated users every hour.
  setInterval(reactivateUsers, 60 * 60 * 1000);
}
