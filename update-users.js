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
    console.log(ids);
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
  // Poll for more users to update in 20 seconds. This just barely maxes out our
  // rate limit for /users/lookup. TODO: If we use credentials from a few
  // different users we could significantly increase our rate.
  // FIXME: Since this is now triggered each time a user logs in, we will
  // gradually wind up with large number of timeouts pending to run
  // findAndUpdateUsers. It's a reasonably cheap call but we should find a
  // better way to limit the maximum outstanding instances.
  setTimeout(findAndUpdateUsers, 20000);
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
}
