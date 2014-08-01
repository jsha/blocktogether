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
    twitter.users("lookup", {skip_status: 1, user_id: ids.join(",")},
      accessToken, accessTokenSecret, updateUsers);
  });
}

// Given a user lookup API response from Twitter, store the user into the DB.
function updateUsers(err, data, response) {
  if (!!err) {
    console.log(err);
    return;
  }
  for (var i = 0; i < data.length; i++) {
    storeUser(data[i]);
  }
  // Poll for more users to update in 1 second.
  setTimeout(findAndUpdateUsers, 1000);
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

findAndUpdateUsers();
