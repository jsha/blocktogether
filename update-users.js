var setup = require('./setup');

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
  usersNeedingUpdate(function(ids) {
    if (ids.length > 0) {
      twitter.users("lookup", {skip_status: 1, user_id: ids.join(",")},
        accessToken, accessTokenSecret, updateUsers);
    } else {
      updateUsers(null, []);
    }
  });
}

// Given a user lookup API response from Twitter, store the user into the DB.
function updateUsers(err, data, response) {
  if (!!err) {
    if (err.statusCode === 429) {
      console.log('Rate limited. Trying again in 15 minutes.');
      setTimeout(findAndUpdateUsers, 15 * 60 * 1000);
    } else {
      console.log(err);
    }
    return;
  }
  for (var i = 0; i < data.length; i++) {
    storeUser(data[i]);
  }
}

// Store a single user into the DB.
function storeUser(twitterUserResponse) {
  TwitterUser
    .find(twitterUserResponse.id_str)
    .error(function(err) {
      console.log(err);
    }).success(function(user) {
      console.log("Succesfully found user @", user.screen_name);
      for (key in twitterUserResponse) {
        if (twitterUserResponse.hasOwnProperty(key)) {
          user[key] = twitterUserResponse[key]
        }
      }
      user.save();
    });
}

module.exports = {
  findAndUpdateUsers: findAndUpdateUsers
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
  setInterval(findAndUpdateUsers, 20 * 1000);
}
