'use strict';
(function() {
/** @type{SetupModule} */
var setup = require('./setup'),
    Q = require('q'),
    _ = require('sequelize').Utils._,
    verifyCredentials = require('./verify-credentials');

var config = setup.config,
    twitter = setup.twitter,
    logger = setup.logger,
    sequelize = setup.sequelize,
    BtUser = setup.BtUser,
    TwitterUser = setup.TwitterUser,
    BlockBatch = setup.BlockBatch,
    Block = setup.Block;

/**
 * Find TwitterUsers needing update, look them up on Twitter, and store in
 * database. A user needs update if it's just been inserted (no screen name)
 * or if it hasn't been updated in a day.
 *
 * We fetch a relatively large chunk from the DB every few seconds, rather than
 * smaller chunks every hundred milliseconds, to ensure there's enough time
 * between each DB query for the API query to complete and to write to the DB.
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
      limit: 5000
    }).then(function(users) {
      updateUsers(_.pluck(users, 'uid'));
    }).catch(function(err) {
      logger.error(err);
    });
}

/**
 * Check each BtUser's credentials for deactivation or reactivation
 * once an hour. Check only users whose uid modulus 360 equals the current
 * second modulus 360, to spread out the work over the hour.
 *
 * TODO: Also update the copy of screen_name on BtUser from the copy of
 * screen_name on TwitterUser in case it changes.
 */
function verifyMany() {
  BtUser
    .findAll({
      where: ['BtUsers.uid % 360 = ?',
        Math.floor(new Date() / 1000) % 360],
      include: [{
        model: TwitterUser
      }]
    }).then(function(btUsers) {
      btUsers.forEach(function (btUser) {
        verifyCredentials(btUser);
        if (btUser.twitterUser) {
          btUser.screen_name = btUser.twitterUser.screen_name;
          if (btUser.changed()) {
            btUser.save().error(function(err) {
              logger.error(err);
            });
          }
        }
      });
    }).catch(function(err) {
      logger.error(err);
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

var userCredentials = [];
var userCredentialsIndex = 0;

/**
 * Given a list of uids, look them up using the Twitter API and update the
 * database accordingly. Split up into chunks of 100, the max the API will
 * return.
 *
 * @param {Array.<string>} uids List of user ids to look up.
 * @return{Promise.<Object>} map of uids succesfully returned to user objects.
 */
function updateUsers(uids) {
  var chunkedUids = [];
  while (uids.length > 0) {
    chunkedUids.push(uids.splice(0, 100));
  }
  return Q.all(
    chunkedUids.map(updateUsersChunk)
  ).then(function(results) {
    var ret = _.reduce(results, _.assign, {});
    console.log(Object.keys(ret));
    return ret;
  })
}

/**
 * Given a list of less than 100 uids, look them up using the Twitter API and
 * update the database accordingly.
 * @param {Array.<string>} uids List of user ids to look up.
 * @return{Object} map of uids succesfully returned to user objects.
 */
function updateUsersChunk(uids) {
  if (!userCredentials.length) {
    throw "user credentials not loaded";
  }
  // Iterate through the user credentials to spread out rate limit usage.
  var credential = userCredentials[userCredentialsIndex];
  userCredentialsIndex = (userCredentialsIndex + 1) % userCredentials.length;
  return Q.ninvoke(twitter, 'users', 'lookup', {
    skip_status: 1,
    user_id: uids.join(',')
  },
  credential.access_token, credential.access_token_secret
  ).spread(function(response, httpResponse) {
    logger.debug('Got /users/lookup response size', response.length,
      'for', uids.length, 'uids');

    // When a user is suspended, deactivated, or deleted, Twitter will simply not
    // return that user object in the response. Delete those users so they don't
    // clog future lookup attempts.
    var indexedResponses = _.indexBy(response, 'id_str');
    uids.forEach(function(uid) {
      if (indexedResponses[uid]) {
        storeUser(indexedResponses[uid]);
      } else {
        logger.info('TwitterUser', uid, 'suspended, deactivated, or deleted. Marking so.');
        deactivateTwitterUser(uid);
      }
    });
    return indexedResponses;
  }).catch(function(err) {
    if (err.statusCode === 429) {
      logger.info('Rate limited /users/lookup.');
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
            if (err.code === 'ER_DUP_ENTRY') {
              // Sometimes these happen when a new user shows up in stream events in
              // very rapid succession. It just means we tried to insert two entries
              // with the same primary key (i.e. uid). It's harmless so we don't log.
            } else {
              logger.error(err);
            }
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
  updateUsers: updateUsers,
  storeUser: storeUser
};

if (require.main === module) {
  BtUser.findAll({
    where: {
      deactivatedAt: null
    },
    limit: 100
  }).then(function(users) {
    userCredentials = users;
    findAndUpdateUsers();
    // Poll for just-added users every 1 second and do an initial fetch of their
    // information.
    setInterval(findAndUpdateUsers.bind(null, 'screen_name IS NULL'), 5000);
    // Poll for users needing update every 10 seconds.
    setInterval(
      findAndUpdateUsers.bind(null, 'updatedAt < (now() - INTERVAL 1 DAY)'), 5000);
    // Every ten seconds, check credentials of some subset of users.
    setInterval(verifyMany, 10000);
  });
}

})();
