var setup = require('./setup'),
    _ = require('sequelize').Utils._;

var config = setup.config,
    twitter = setup.twitter,
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
      console.log(err);
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

// Given a user lookup API response from Twitter, store the user into the DB.
function updateUsers(uids, err, data, response) {
  if (!!err) {
    if (err.statusCode === 429) {
      console.log('Rate limited. Trying again in 15 minutes.');
      setTimeout(findAndUpdateUsers, 15 * 60 * 1000);
    } else {
      console.log(err);
    }
    return;
  }
  console.log("Got /users/lookup response size", data.length,
    "for", uids.length, "uids");
  foundUids = {}
  data.forEach(function(twitterUserResponse) {
    storeUser(twitterUserResponse);
    foundUids[twitterUserResponse.uid] = 1;
  });

  uids.forEach(function(uid) {
    if (foundUids[uid]) {
      console.log('Did not find uid', uid, 'probably suspended.');
    }
  });
}

// Store a single user into the DB.
function storeUser(twitterUserResponse) {
  TwitterUser
    .findOrCreate({ uid: twitterUserResponse.id_str })
    .error(function(err) {
      console.log(err);
    }).success(function(user, created) {
      user = _.extend(user, twitterUserResponse);
      user.save()
        .error(function(err) {
          console.log(err);
        }).success(function(user) {
          if (created) {
            console.log("Updated user ", user.screen_name);
          } else {
            console.log("Created user ", user.screen_name);
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
