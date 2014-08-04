var twitterAPI = require('node-twitter-api'),
    fs = require('fs'),
    actions = require('./actions'),
    setup = require('./setup');

var twitter = setup.twitter,
    Action = setup.Action,
    BtUser = setup.BtUser;

/**
 * For each user with stored credentials, start receiving their Twitter user
 * stream, in order to be able to insta-block any new users (< 7 days old)
 * who @-reply one of our users.
 *
 * TODO: Also collect block and unblock events.
 * TODO: Test that streams are restarted after network down events.
 */
function startStreams() {
  BtUser
    .findAll()
    .complete(function(err, users) {
      if (!!err) {
        console.log(err);
        return;
      }
      users.forEach(function(user) {
        var accessToken = user.access_token;
        var accessTokenSecret = user.access_token_secret;
        var boundDataCallback = dataCallback.bind(undefined, user);
        var boundEndCallback = endCallback.bind(undefined, user.uid);

        console.log('Starting user stream for uid', user.uid);
        twitter.getStream('user', {
          'replies': 'all',
          // Only get user-related events, not all tweets in timeline.
          'with': 'user'
        }, accessToken, accessTokenSecret, boundDataCallback, endCallback);
      });
    });
}

startStreams();

function endCallback(uid) {
  console.log("Ending stream for", uid);
}

/**
 * Called each time there is data available on the user stream.
 * Given the arguments passed to getStream, the only events we receive should be
 * at-replies. TODO: Add sanity check to filter non-at-replies, just in case.
 *
 * On receiving an at-reply, check the age of the sender. If it is less than
 * seven days, block them. Exception: Do not block someone our user already follows.
 */
function dataCallback(recipientBtUser, err, data, ret, res) {
  var recipientUid = recipientBtUser.uid;
  // If present, data.user is the user who sent the at-reply.
  if (data && data.text && data.user && data.user.created_at &&
      data.user.id_str !== recipientUid) {
    var ageInDays = (new Date() - Date.parse(data.user.created_at)) / 86400 / 1000;
    console.log(recipientBtUser.screen_name, 'got at reply from',
      data.user.screen_name, ' (age ', ageInDays, ')');
    if (ageInDays < 7 && recipientBtUser.block_new_accounts) {
      enqueueBlock(recipientBtUser, data.user);
    }
  }
}

/**
 * Put a block on the Actions list for this user and process it.
 */
function enqueueBlock(recipientBtUser, targetUser) {
  actions.queueBlocks(recipientBtUser.uid, [targetUser.id_str]);
  // HACK: Wait 500 ms and then process actions for the user. The ideal thing
  // here would be for queueBlocks to automatically kick off a processing run
  // for its source_uid.
  setTimeout(function() {
    actions.processActionsForUserId(recipientBtUser.uid);
  }, 500);
}
