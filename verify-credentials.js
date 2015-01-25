'use strict';
(function() {

var logger = require('./setup').logger,
    twitter = require('./setup').twitter;

/**
 * Ask Twitter to verify a user's credentials. If they are not valid,
 * store the current time in user's deactivatedAt. If they are valid, clear
 * the user's deactivatedAt. Save the user to DB if it's changed.
 * A user can be deactivated because of suspension, deactivation, or revoked
 * app. Each of these states (even revocation!) can be undone, and we'd
 * like the app to resume working normally if that happens. So instead of
 * deleting the user when we get one of these codes, store a 'deactivatedAt'
 * timestamp on the user object. Users with a non-null deactivatedAt
 * get their credentials retried once per day for 30 days, after which (TOD)
 * they should be deleted. Regular operations like checking blocks or
 * streaming are not performed for users with non-null deactivatedAt.
 */
function verifyCredentials(user) {
  twitter.account('verify_credentials', {}, user.access_token,
    user.access_token_secret, function(err, results) {
      if (err && err.data) {
        // For some reason the error data is given as a string, so we have to
        // parse it.
        var errJson = JSON.parse(err.data);
        if (errJson.errors &&
            errJson.errors.some(function(e) { return e.code === 89 })) {
          logger.warn('User', user, 'revoked app.');
          user.deactivatedAt = new Date();
        } else if (err.statusCode === 404) {
          //Testing for issue #146 indicates calling verify_credentials
          //for a suspended account will return success, not a 404. Leaving
          //this code in-place for robustness and in case there are
          //differences between suspended accounts we may not be aware of.
          logger.warn('User', user, 'deactivated or suspended.')
          user.deactivatedAt = new Date();
        } else {
          logger.warn('User', user, 'verify_credentials', err.statusCode);
        }
      } else {
        //We need a second lookup to the users.show.json endpoint to detect
        //suspension status for issue #146
        twitter.users('show',
          { user_id: user.uid },
          user.access_token,
          user.access_token_secret,
          function(err, response) {
            if (err) {
              // Testing using a suspended account does not seem to return
              // 403 or 404. Leaving this here for robustness, see comments
              // in error case of verify_credentials response handler.
              if (err.statusCode === 403 || err.statusCode === 404) {
                logger.warn('User', user, 'is deactivated or suspended. Marking so', err.statusCode);
                user.deactivatedAt = new Date();
              } else {
                logger.warn('User', user, 'unknown error on /user/lookup', err);
              }
            } else {
              // Testing for #146 showed the response.suspended field to be
              // a reliable indicator of whether an account was suspended.
              if (response && response.suspended === true)
              {
                logger.warn('User', user, 'is suspended. Marking so');
                user.deactivatedAt = new Date();
              } else {
                logger.info('User', user, 'has not revoked app or deactivated.');
                user.deactivatedAt = null;
              }
            }
          }
        );
      }
      if (user.changed()) {
        user.save().error(function(err) {
          logger.error(err);
        });
      }
  });
}

module.exports = {
  verifyCredentials: verifyCredentials
};

})();
