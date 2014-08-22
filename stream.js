var twitterAPI = require('node-twitter-api'),
    fs = require('fs'),
    actions = require('./actions'),
    https = require('https'),
    updateUsers = require('./update-users'),
    updateBlocks = require('./update-blocks'),
    setup = require('./setup');

var twitter = setup.twitter,
    logger = setup.logger,
    Action = setup.Action,
    UnblockedUser = setup.UnblockedUser,
    BtUser = setup.BtUser;

// An associative array of streams currently running. Indexed by uid.
var streams = {
  'dummy': 1 // Start with a dummy uid to make the findAll query simpler.
};

// Set the maximum number of sockets higher so we can have a reasonable number
// of streams going.
// TODO: Request Site Streams access.
// TODO: Only start streams for users who have block_new_accounts = true.
https.globalAgent.maxSockets = 10000;

/**
 * For each user with stored credentials, start receiving their Twitter user
 * stream, in order to be able to insta-block any new users (< 7 days old)
 * who @-reply one of our users.
 *
 * TODO: Also collect block and unblock events.
 * TODO: Test that streams are restarted after network down events.
 */
function startStreams() {
  logger.info('Active streams:', Object.keys(streams).length);
  // Find all users who don't already have a running stream.
  BtUser
    .findAll({
      where: {
        uid: { not: Object.keys(streams) },
        block_new_accounts: true
      },
      limit: 10
    }).error(function(err) {
      logger.error(err);
    }).success(function(users) {
      users.forEach(function(user) {
        var accessToken = user.access_token;
        var accessTokenSecret = user.access_token_secret;
        var boundDataCallback = dataCallback.bind(undefined, user);
        var boundEndCallback = endCallback.bind(undefined, user);

        logger.info('Starting stream for user', user.screen_name, user.uid);
        var req = twitter.getStream('user', {
          // Get events for all replies, not just people the user follows.
          'replies': 'all',
          // Only get user-related events, not all tweets in timeline.
          'with': 'user'
        }, accessToken, accessTokenSecret, boundDataCallback, boundEndCallback);

        streams[user.uid] = req;
      });
    });
}

function deleteIfRevoked(user) {
  twitter.account('verify_credentials', {}, user.access_token,
    user.access_token_secret, function(err, results) {
      if (err && err.data) {
        // For some reason the error data is given as a string, so we have to
        // parse it.
        var errJson = JSON.parse(err.data);
        if (errJson.errors &&
            errJson.errors.some(function(e) { return e.code === 89 })) {
          logger.warn('User', user.screen_name, 'revoked app, deleting.');
          user.destroy();
        } else {
          logger.warn('Unknown error', err.statusCode, 'for', user.screen_name,
            user.uid, err.data);
        }
      } else {
        logger.warn('User', user.screen_name, 'has not revoked app.');
      }
  });
}

function endCallback(user) {
  logger.warn('Ending stream for', user.screen_name);
  deleteIfRevoked(user);
  delete streams[user.uid];
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
  if (!data) return;
  if (data.disconnect) {
    logger.warn(recipientBtUser.screen_name,
      'disconnect message:', data.disconnect);
    // Code 6 is for revoked, e.g.:
    // { code: 6, stream_name:
    //   'twestact4&XXXXXXXXXXXXXXXXXXXXXXXXX-userstream685868461329014147',
    //    reason: 'token revoked for userId 596947990' }
    // Codes 13 and 14 are for user deleted and suspended, respectively.
    // TODO: Each of these states (even revocation!) can be undone, and we'd
    // like the app to resume working normally if that happens. So instead of
    // deleting the user when we get one of these codes, store a 'deactivatedAt'
    // timestamp on the user object. Users with a non-null deactivatedAt would
    // get their credentials retried once per day for 30 days, after which they
    // would be deleted. Regular operations like checking blocks or streaming
    // would not be performed while their deactivatedAt was non-null.
    if (data.disconnect.code === 6 ||
        data.disconnect.code === 13 ||
        data.disconnect.code === 14) {
      deleteIfRevoked(recipientBtUser);
    }
  } else if (data.warning) {
    logger.warn(recipientBtUser.screen_name,
      'stream warning message:', data.warning);
  } else if (data.event) {
    logger.info(recipientBtUser.screen_name, 'event', data.event);
    // If the event target is present, it's a Twitter User object, and we should
    // save it if we don't already have it.
    if (data.target) {
      updateUsers.storeUser(data.target);
    }

    handleUnblock(data);
  } else if (data.text) {
    // If present, data.user is the user who sent the at-reply.
    if (data.user && data.user.created_at &&
        data.user.id_str !== recipientUid) {
      var ageInDays = (new Date() - Date.parse(data.user.created_at)) / 86400 / 1000;
      logger.info(recipientBtUser.screen_name, 'got at reply from',
        data.user.screen_name, ' (age ', ageInDays, ')');
      // The user may have changed settings since we started the stream. Reload to
      // get the latest setting.
      recipientBtUser.reload().success(function() {
        if (ageInDays < 7 && recipientBtUser.block_new_accounts) {
          enqueueBlock(recipientBtUser, data.user);
        }
      });
    }
  }
}

function handleUnblock(data) {
  if (data.event === 'unblock') {
    UnblockedUser.find({
      where: {
        source_uid: data.source.id_str,
        sink_uid: data.target.id_str
      }
    }).error(function(err) {
      logger.error(err);
    }).success(function(unblockedUser) {
      if (!unblockedUser) {
        unblockedUser = UnblockedUser.build({
          source_uid: data.source.id_str,
          sink_uid: data.target.id_str
        });
      }
      unblockedUser.save().error(function(err) {
        logger.error(err);
      });
    });
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

startStreams();
setInterval(startStreams, 5 * 1000);
