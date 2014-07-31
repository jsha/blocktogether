var mysql = require('mysql'),
    setup = require('./setup');

var config = setup.config;
var mysqlConnection = setup.mysqlConnection;
var twitter = setup.twitter;
var accessToken = config.defaultAccessToken;
var accessTokenSecret = config.defaultAccessTokenSecret;

// Find a list of uids that haven't been updated recently, and pass them to the
// callback as an array of strings.
function uidsNeedingUpdate(callback) {
  uidsQuery = 'select uid from user where updated = 0 or screen_name is null limit 100;';
  mysqlConnection.query(uidsQuery, function(err, rows) {
    if (err) {
      console.log("Error gettig uids: " + err);
    }

    ids = [];
    for (var i = 0; i < rows.length; i++) {
      ids.push(rows[i].uid);
    }
    callback(ids);
  });
}

// Find uids needing update, look them up on Twitter, and store in database.
function findAndUpdateUsers() {
  uidsNeedingUpdate(function() {
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
function storeUser(user) {
  storeUserQuery = mysql.format(
    'replace into user (uid, friends_count, followers_count,' +
    '  profile_image_url_https, screen_name, name, json) values' +
    ' (?, ?, ?, ?, ?, ?, ?);',
    [user.id_str, user.friends_count, user.followers_count,
     user.profile_image_url_https, user.screen_name, user.name,
     JSON.stringify(user)]);
  mysqlConnection.query(storeUserQuery, function(err, rows) {
    if (err) {
      console.log("Error storing user lookup results: " + err);
    } else {
      console.log("Succesfully stored user @", user.screen_name);
    }
  });
}

findAndUpdateUsers();
