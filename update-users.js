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

// Find a list of uids that haven't been updated recently, and pass them to the
// callback as an array of strings.
function usersNeedingUpdate(callback) {
  TwitterUser
    .findAll({
      where: 'screen_name is null',
      order: 'createdAt DESC',
      limit: 100
    }).error(function(err) {
      logger.error(err);
    }).success(function(users) {
      callback(users.map(function(user) {
        return user.uid;
      }));
    });
}

// Find uids needing update, look them up on Twitter, and store in database.
function findAndUpdateUsers() {
  usersNeedingUpdate(function(uids) {
    if (uids.length > 0) {
      twitter.users("lookup", {skip_status: 1, user_id: uids.join(",")},
        accessToken, accessTokenSecret, updateUsers.bind(null, uids));
    } else {
      updateUsers(null, []);
    }
  });
}

function deleteUser(uid) {
  TwitterUser.destroy({ uid: uid }).error(function(err) {
    logger.error(err);
  }).success(function() {
    logger.debug('Deleted suspended user', uid);
  });
}

// Given a user lookup API response from Twitter, store the user into the DB.
function updateUsers(uids, err, data, response) {
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
  logger.info("Got /users/lookup response size", data.length,
    "for", uids.length, "uids");
  foundUids = {}
  data.forEach(function(twitterUserResponse) {
    storeUser(twitterUserResponse);
    foundUids[twitterUserResponse.id_str] = 1;
  });

  uids.forEach(function(uid) {
    if (!foundUids[uid]) {
      logger.warn('Did not find uid', uid, 'probably suspended. Deleting.');
      deleteUser(uid);
    }
  });
}

// Store a single user into the DB.
function storeUser(twitterUserResponse) {
  TwitterUser
    .findOrCreate({ uid: twitterUserResponse.id_str })
    .error(function(err) {
      logger.error(err);
    }).success(function(user, created) {
      user = _.extend(user, twitterUserResponse);
      user.save()
        .error(function(err) {
          logger.error(err);
        }).success(function(user) {
          if (created) {
            logger.debug("Updated user ", user.screen_name);
          } else {
            logger.debug("Created user ", user.screen_name);
          }
        });
    });
}

module.exports = {
  findAndUpdateUsers: findAndUpdateUsers,
  storeUser: storeUser
};

if (require.main === module) {
  findAndUpdateUsers();
  // Poll for more users to update every 20 seconds. This just barely maxes out our
  // rate limit for /users/lookup. TODO: If we use credentials from a few
  // different users we could significantly increase our rate.
  // TODO: When we know there are still pending users, we should go faster. E.g.
  // when a user with very many blocks signs in, we want to look up each of
  // their blocked users very quickly so we can display screen names.
  // However, this runs into issues with suspended users, because they will
  // always 404 and so always remain pending.
  setInterval(findAndUpdateUsers, 2000);
}
