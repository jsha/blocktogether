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
    }).then(function(users) {
      if (users && users.length > 0) {
        updateUsers(_.pluck(users, 'uid'), _.indexBy(users, 'uid'));
      }
    }).catch(function(err) {
      logger.error(err);
    });
}

/**
 * Check each BtUser's credentials for deactivation or reactivation
 * once an hour. Check only users whose uid modulus 3600 equals the current
 * second modulus 3600, to spread out the work over the hour.
 *
 * TODO: Also update the copy of screen_name on BtUser from the copy of
 * screen_name on TwitterUser in case it changes.
 */
function verifyMany() {
  BtUser
    .findAll({
      where: ['BtUser.uid % 3600 = ?',
        Math.floor(new Date() / 1000) % 3600],
      include: [{
        model: TwitterUser
      }]
    }).then(function(btUsers) {
      btUsers.forEach(function (btUser) {
        verifyCredentials(btUser);
        if (btUser.TwitterUser) {
          btUser.screen_name = btUser.TwitterUser.screen_name;
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
  return TwitterUser.findById(uid)
    .then(function(twitterUser) {
      if (twitterUser) {
        twitterUser.deactivatedAt = new Date();
        return twitterUser.save();
      } else {
        return Q.reject('No user found for uid', uid);
      }
    }).then(function(twitterUser) {
      logger.debug('Deactivated user', twitterUser.screen_name, uid);
      return twitterUser;
    }).catch(function(err) {
      logger.error(err);
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
 * @param {Map.<string,TwitterUser>} usersMap Optional map from uids to TwitterUser
 *   objects from a previous DB lookup. This can save a final lookup before
 *   saving.
 * @return{Promise.<Object>} map of uids succesfully returned to user objects.
 *   If the Twitter API returns no result for an account, there will be no entry
 *   in the map under that uid, even if there is a deactivated TwitterUser
 *   stored in the DB.
 */
function updateUsers(uids, usersMap) {
  if (!userCredentials.length) {
    logger.info('User credentials not yet loaded, setting timer');
    return Q.timeout(500).then(updateUsers.bind(null, uids, usersMap));
  }
  var length = uids.length;
  if (!length) {
    logger.info('No uids to update');
    return Q.resolve({});
  }
  var chunkedUids = [];
  var chunkSize = 100;
  for (var i = 0; i < length; i += chunkSize) {
    chunkedUids.push(uids.slice(i, i + chunkSize));
  }
  return Q.all(
    chunkedUids.map(function(uidChunk) {
      return updateUsersChunk(uidChunk, usersMap);
    })
  ).then(function(results) {
    var ret = _.reduce(results, _.assign, {});
    logger.info('Updated', Object.keys(ret).length, 'TwitterUsers (asked for', length, ')');
    return ret;
  })
}

/**
 * Given a list of less than 100 uids, look them up using the Twitter API and
 * update the database accordingly.
 * @param {Array.<string>} uids List of user ids to look up.
 * @param {Map.<string,TwitterUser>} usersMap A map from uids to TwitterUser
 *   objects from a previous DB lookup. This can save a final lookup before
 *   saving.
 * @return{Object} map of uids succesfully returned to user objects.
 */
function updateUsersChunk(uids, usersMap) {
  usersMap = usersMap || {};
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
    uids.map(function(uid) {
      if (indexedResponses[uid]) {
        storeUser(indexedResponses[uid], usersMap[uid]);
      } else {
        logger.info('TwitterUser', uid, 'suspended, deactivated, or deleted. Marking so.');
        deactivateTwitterUser(uid);
      }
    });
    return indexedResponses;
  }).catch(function(err) {
    if (err.statusCode === 429) {
      logger.info('Rate limited /users/lookup.');
      return Q.reject('Rate limited');
    } else if (err.statusCode === 404) {
      // When none of the users in a lookup are available (i.e. they are all
      // suspended or deleted), Twitter returns 404. Deactivate all of them.
      logger.info('Twitter returned 404 to /users/lookup, deactivating',
        uids.length, 'users');
      return Q.all(
        uids.map(deactivateTwitterUser)
      ).then(function() {
        return Q.resolve({});
      });
    } else {
      if (err.statusCode == 403 || err.statusCode == 401) {
        verifyCredentials(credential);
      }
      logger.error('Error /users/lookup', err.statusCode, err.data, err);
      return Q.reject('Error /users/lookup');
    }
  });
}

/**
 * Store a single user into the DB. If the user was marked deactivated,
 * reactivate them.
 * @param {Object} twitterUserResponse A JSON User object as defined by the
 *   Twitter API. https://dev.twitter.com/docs/platform-objects/users
 * @param {TwitterUser|null} userObj An optional param giving the existing user
 *   object. Saves a lookup when running update-users.js as a daemon.
 */
function storeUser(twitterUserResponse, userObj) {
  function store(user, created) {
    _.assign(user, twitterUserResponse);
    // This field is special because it needs to be parsed as a date, and
    // because the default name 'created_at' is too confusing alongside
    // Sequelize's built-in createdAt.
    user.account_created_at = new Date(twitterUserResponse.created_at);
    user.deactivatedAt = null;
    if (user.changed()) {
      return user.save()
        .then(function(savedUser) {
          logger.debug('Saved user', savedUser.screen_name, savedUser.id_str);
          return savedUser;
        }).catch(function(err) {
          if (err.code === 'ER_DUP_ENTRY') {
            // Sometimes these happen when a new user shows up in stream events in
            // very rapid succession. It just means we tried to insert two entries
            // with the same primary key (i.e. uid). It's harmless so we don't log.
          } else {
            logger.error(err);
          }
          return null;
        });
    } else {
      logger.debug('Skipping update for', user.screen_name, user.id_str);
      return user;
    }
  }

  if (userObj) {
    return store(userObj);
  } else {
    return TwitterUser
      .findOrCreate({
        where: {
          uid: twitterUserResponse.id_str
        },
        defaults: {
          uid: twitterUserResponse.id_str
        }
      }).spread(store)
      .catch(function(err) {
        logger.error(err);
      });
  }
}

module.exports = {
  updateUsers: updateUsers,
  storeUser: storeUser
};

BtUser.findAll({
  where: {
    deactivatedAt: null
  },
  limit: 100
}).then(function(users) {
  if (users && users.length > 0) {
    userCredentials = users;
  } else {
    logger.error('No user credentials found.');
  }
}).catch(function(err) {
  logger.error(err);
});

if (require.main === module) {
  findAndUpdateUsers();
  // Poll for just-added users every 1 second and do an initial fetch of their
  // information.
  setInterval(findAndUpdateUsers.bind(null, ['screen_name IS NULL']), 5000);
  // Poll for users needing update every 10 seconds.
  setInterval(
    findAndUpdateUsers.bind(null, ['updatedAt < (now() - INTERVAL 1 DAY)']), 2500);
  // Every ten seconds, check credentials of some subset of users.
  setInterval(verifyMany, 10000);
}

})();
