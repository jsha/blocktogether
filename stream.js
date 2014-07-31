var mysql = require('mysql'),
    twitterAPI = require('node-twitter-api'),
    fs = require('fs'),
    setup = require('./setup');

var mysqlConnection = setup.mysqlConnection;
var twitter = setup.twitter;

/**
 * For each user with stored credentials, start receiving their Twitter user
 * stream, in order to be able to insta-block any new users (< 1 day old)
 * who @-reply one of our users.
 *
 * TODO: Also collect block and unblock events.
 * TODO: Test that streams are restarted after network down events.
 */
function startStreams(mysqlConnection) {
  mysqlConnection.query('select uid, screen_name, access_token, access_token_secret ' +
    'from twitter_tokens natural join user;', function(err, rows) {
    if (err) {
      console.log(err);
    } else {
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var accessToken = row.access_token;
        var accessTokenSecret = row.access_token_secret;
        var boundDataCallback = dataCallback.bind(
          undefined, accessToken, accessTokenSecret);
        var boundEndCallback = endCallback.bind(
          undefined, row.screen_name);

        console.log('Starting user stream for uid ', row.uid, ' screen name ',
          row.screen_name);
        twitter.getStream('user', {
          'replies': 'all',
          // Only get user-related events, not all tweets in timeline.
          'with': 'user'
        }, accessToken, accessTokenSecret, boundDataCallback, endCallback);
      }
    }
  });
}

startStreams(mysqlConnection);

function endCallback(screen_name) {
  console.log("Ending stream for ", screen_name);
  mysqlConnection.destroy();
}

function uidFromAccessToken(accessToken) {
  return accessToken.split("-")[0];
}

/**
 * Called each time there is data available on the user stream.
 * Given the arguments passed to getStream, the only events we receive should be
 * at-replies. TODO: Add sanity check to filter non-at-replies, just in case.
 *
 * On receiving an at-reply, check the age of the sender. If it is less than one
 * day, block them. Exception: Do not block someone our user already follows.
 */
function dataCallback(accessToken, accessTokenSecret, err, data, ret, res) {
  console.log(data);
  var recipientUid = uidFromAccessToken(accessToken);
  if (data && data.text && data.user && data.user.created_at &&
      data.user.id_str !== recipientUid) {
    var age = (new Date() - Date.parse(data.user.created_at)) / 86400 / 1000;
    console.log(uidFromAccessToken(accessToken), " got ",
      data.user.screen_name, " (age ", age, "):", data.text);
    if (age < 1000) {
      blockUnlessFollowing(accessToken, accessTokenSecret, data.user);
    }
  }
}

/**
 * Check whether our user follows a given user; If not block them.
 */
function blockUnlessFollowing(accessToken, accessTokenSecret, targetUser) {
  blockerUid = uidFromAccessToken(accessToken);
  twitter.friendships('lookup', {
    user_id: targetUser.id_str,
  }, accessToken, accessTokenSecret, function(err, data, response) {
    if (err) {
      console.log(err);
    } else {
      // An example item from the friendships/lookup.json API:
      // [ { name: 'Foo Bar',
      //     screen_name: 'foobar',
      //     id: 123456789,
      //     id_str: '123456789',
      //     connections: [ 'none' ] } ]
      // OR:
      //  ...
      //     connections: [ 'following' ] } ]
      var following = data.some(function(item) {
        if (item.id_str === targetUser.id_str) {
          return item.connections.some(function(connection) {
            return connection === 'following';
          });
        }
      });
      console.log('following', following);
      if (!following) {
        twitter.blocks('create', {
          user_id: targetUser.id_str,
          skip_status: 1
        }, accessToken, accessTokenSecret, function(err, results) {
          if (err) {
            console.log('Error creating block ', blockerUid,
              ' -block-> ', targetUser.id_str, ': ', err);
          } else {
            console.log('Success creating block ', blockerUid,
              ' -block-> ', targetUser.id_str, ': ', results);
          }
        });
      }
    }
  });
}
