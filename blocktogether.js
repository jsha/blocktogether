'use strict';
(function() {
var express = require('express'), // Web framework
    url = require('url'),
    bodyParser = require('body-parser'),
    cookieSession = require('cookie-session'),
    crypto = require('crypto'),
    mu = require('mu2'),          // Mustache.js templating
    passport = require('passport'),
    TwitterStrategy = require('passport-twitter').Strategy,
    Q = require('q'),
    timeago = require('timeago'),
    constantTimeEquals = require('scmp'),
    setup = require('./setup'),
    actions = require('./actions'),
    updateUsers = require('./update-users'),
    _ = require('lodash');

var config = setup.config,
    twitter = setup.twitter,
    logger = setup.logger,
    userToFollow = setup.userToFollow,
    remoteUpdateBlocks = setup.remoteUpdateBlocks,
    BtUser = setup.BtUser,
    Action = setup.Action,
    BlockBatch = setup.BlockBatch,
    Block = setup.Block,
    TwitterUser = setup.TwitterUser,
    Subscription = setup.Subscription;

// Maximum size of a block list that can be subscribed to.
const maxSubscribeSize = 250000;

// Look for templates here
mu.root = __dirname + '/templates';

function makeApp() {
  // Create the server
  var app = express();
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(cookieSession({
    keys: [config.cookieSecret],
    secureProxy: config.secureProxy
  }));
  app.use('/static', express["static"](__dirname + '/static'));
  app.use('/', express["static"](__dirname + '/static'));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(new TwitterStrategy({
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret,
    callbackURL: config.callbackUrl
  }, passportSuccessCallback));

  // Serialize the uid and credentials into session. TODO: use a unique session
  // id instead of the Twitter credentials to save cookie space and reduce risk
  // of Twitter credential exposure.
  passport.serializeUser(function(user, done) {
    done(null, JSON.stringify({
      uid: user.uid,
      accessToken: user.access_token
    }));
  });

  // Given the serialized uid and credentials, try to find the corresponding
  // user in the BtUsers table. If not found, that's fine - it might be a
  // logged-out path. Logged-out users are handled in requireAuthentication
  // below.
  passport.deserializeUser(function(serialized, done) {
    var sessionUser = JSON.parse(serialized);
    return BtUser.find({
      where: {
        uid: sessionUser.uid,
        deactivatedAt: null
      }, include: [{
        // Include a TwitterUser so, for instance, we can check how long a
        // BtUser has been on Twiter.
        model: TwitterUser
      }]
    }).then(function(user) {
      // It's probably unnecessary to do constant time compare on these, since
      // the HMAC on the session cookie should prevent an attacker from
      // submitting arbitrary valid sessions, but this is nice defence in depth
      // against timing attacks in case the cookie secret gets out.
      if (user &&
          constantTimeEquals(user.access_token, sessionUser.accessToken)) {
        done(null, user);
      } else {
        logger.error('Incorrect access token in session for', sessionUser.uid);
        done(null, undefined);
      }
      return null;
    }).catch(function(err) {
      logger.error(err);
      // User not found in DB. Leave the user object undefined.
      done(null, undefined);
      return null;
    });
  });
  return app;
}

function HttpError(code, message) {
  var error = new Error(message);
  error.statusCode = code;
  return error;
}

/**
 * Callback for Passport to call once a user has authorized with Twitter.
 * @param {String} accessToken Access Token
 * @param {String} accessTokenSecret Access Token Secret
 * @param {Object} profile Passport's profile object, which contains the Twitter
 *                          user object.
 * @param {Function} done Function to call with the BtUSer object once it is
 *                        created.
 */
function passportSuccessCallback(accessToken, accessTokenSecret, profile, done) {
  var uid = profile.id;
  var screen_name = profile.username;

  BtUser
    .find({
      where: {
        uid: uid
      }
    }).then(function(btUser) {
      if (!btUser) {
        return BtUser.create({
          uid: uid,
          screen_name: screen_name,
          access_token: accessToken,
          access_token_secret: accessTokenSecret,
          shared_blocks_key: null,
          block_new_accounts: false,
          block_low_followers: false,
          follow_blocktogether: false,
          pendingActions: 0,
          paused: false,
          blockCount: null,
          deactivatedAt: null
        });
      } else {
        // The user's access token may have changed since last login, or they may
        // have been previously deactivated. Overwrite appropriate values with
        // their latest version.
        _.assign(btUser, {
          screen_name: screen_name,
          access_token: accessToken,
          access_token_secret: accessTokenSecret,
          deactivatedAt: null
        });
        return btUser.save();
      }
    }).then(function(btUser) {
      // Make sure we have a TwitterUser for each BtUser. We rely on some of
      // the extended information in that structure being present.
      return [btUser, updateUsers.storeUser(profile._json)];
    }).spread(function(btUser, twitterUser) {
      remoteUpdateBlocks(btUser).catch(function(err) {
        logger.error('Updating blocks:', err);
      });
      done(null, btUser);
    }).catch(function(err) {
      logger.error('Logging in:', err);
      done(null, undefined);
    });
}

var app = makeApp();

// Set some default security headers for every response.
app.get('/*', function(req, res, next) {
  res.header('X-Frame-Options', 'SAMEORIGIN');
  res.header('Content-Security-Policy', "default-src 'self';");
  next();
});
// Reload templates automatically in dev mode.
app.get('/*', function(req, res, next) {
  if (process.env.NODE_ENV == 'development') {
    mu.clearCache();
  }
  next();
});
// All requests get passed to the requireAuthentication function; Some are
// exempted from authentication checks there.
app.all('/*', requireAuthentication);

// CSRF protection. Check the provided CSRF token in the request body against
// the one in the session.
app.post('/*', function(req, res, next) {
  if (!constantTimeEquals(req.session.csrf, req.body.csrf_token) ||
      !req.session.csrf) {
    return next(new HttpError(403, 'Invalid CSRF token.'));
  } else {
    return next();
  }
});

// Add CSRF token if not present in session.
app.all('/*', function(req, res, next) {
  req.session.csrf = req.session.csrf || crypto.randomBytes(32).toString('base64');
  return next();
});

// Both the actions page and the show-blocks page allow searching by screen
// name. For either of them, we do the work of looking up the twitterUser here,
// then store the result in req.searched_user. If the screen name requested is
// not found, screenNameLookup will not error. It's up to the page itself
// to decide how to display that information.
app.get('/show-blocks/*', screenNameLookup);
app.get('/actions', screenNameLookup);
function screenNameLookup(req, res, next) {
  if (req.query.screen_name) {
    if (!req.query.screen_name.match(/^[A-Za-z0-9_]{1,20}$/)) {
      return next(new HttpError(400, 'Invalid screen name'));
    } else {
      return TwitterUser.findOne({
        where: {
          screen_name: req.query.screen_name
        }
      }).then(function(twitterUser) {
        req.searched_user = twitterUser;
        return next();
      }).catch(next);
    }
  } else {
    return next();
  }
}

// Redirect the user to Twitter for authentication.  When complete, Twitter
// will redirect the user back to the application at
//   /auth/twitter/callback
var passportAuthenticate = passport.authenticate('twitter');
app.post('/auth/twitter', function(req, res, next) {
  // If this was a Sign Up (vs a Log On), store any settings in the session, to
  // be applied to the BtUser after successful Twitter authentication.
  if (req.body.signup) {
    req.session.signUpSettings = {
      block_new_accounts: req.body.block_new_accounts,
      block_low_followers: req.body.block_low_followers,
      share_blocks: req.body.share_blocks,
      follow_blocktogether: req.body.follow_blocktogether
    };
  }
  // If a non-logged-in user tries to subscribe to a block list, we store the
  // shared_blocks_key for that list in the session so we can perform the action
  // when they return.
  if (req.body.subscribe_on_signup_key) {
    logger.info('Storing subscribe_on_signup');
    req.session.subscribe_on_signup = {
      key: req.body.subscribe_on_signup_key,
      author_uid: req.body.subscribe_on_signup_author_uid
    };
  }
  // This happened once in development, and may be happening in production. Add
  // logging to see if it is.
  if (!passportAuthenticate) {
    logger.error('passportAuthenticate is mysteriously undefined');
  }
  passportAuthenticate(req, res, next);
});

function logInAndRedirect(req, res, next, user) {
  req.logIn(user, function(err) {
    if (err) {
      return next(err);
    }
    // Store a uid cooke for nginx logging purposes.
    res.cookie('uid', user.uid, {
      secure: true,
      httpOnly: true
    });
    if (req.session.subscribe_on_signup) {
      logger.info('Got subscribe_on_signup for', req.user, 'redirecting.');
      return res.redirect('/subscribe-on-signup');
    } else {
      return res.redirect('/settings');
    }
  });
}

// Twitter will redirect the user to this URL after approval.  Finish the
// authentication process by attempting to obtain an access token.  If
// access was granted, the user will be logged in.  Otherwise,
// authentication has failed.
// If this was a Sign Up (vs a Log On), there will be a signUpSettings in the
// session field, so apply those settings and then remove them from the session.
app.get('/auth/twitter/callback', function(req, res, next) {
  var passportCallbackAuthenticate =
    passport.authenticate('twitter', function(err, user, info) {
      // One common error case: Use visits blocktogether in two different
      // browser tabs, hits 'log on' in each, gets Twitter login page on each,
      // logs in on one, and then logs in on the other. Results in Passport
      // error 'Failed to find request token in session'. Easy workaround:
      // ignore errors if we already have a working session.
      if (err && req.user) {
        logInAndRedirect(req, res, next, req.user);
      } else if (err) {
        // Most errors default to 500 unless they are specifically treated
        // differently, but Passport throws a number of errors that are mostly
        // not internal (e.g. server failed, cookies not present in request,
        // etc), so we call them 403's.
        return next(new HttpError(403, err.message));
      } else if (!user) {
        return next(new HttpError(403, 'Problem during app authorization.'));
      } else {
        // If this was a signup (vs a log on), set settings based on what the user
        // selected on the main page.
        if (req.session.signUpSettings) {
          updateSettings(user, req.session.signUpSettings).then(function(user) {
            delete req.session.signUpSettings;
            logInAndRedirect(req, res, next, user);
          });
        } else {
          // If this was a log on, don't set signUpSettings.
          logInAndRedirect(req, res, next, user);
        }
        return null
      }
    });
  passportCallbackAuthenticate(req, res, next);
});

function requireAuthentication(req, res, next) {
  if (req.url == '/' ||
      req.url == '/logout' ||
      req.url == '/logged-out' ||
      req.url == '/favicon.ico' ||
      req.url == '/robots.txt' ||
      req.url.match('/auth/.*') ||
      req.url.match('/show-blocks/.*') ||
      req.url.match('/static/.*')) {
    return next();
  } else if (req.user && req.user.TwitterUser) {
    // If there's a req.user there should always be a corresponding TwitterUser.
    // If not, logging back in will fix.
    return next();
  } else {
    // Not authenticated, but should be.
    return res.format({
      html: function() {
        // Clear the session in case it's in a bad state.
        req.session = null;
        res.redirect('/');
      },
      json: function() {
        res.statusCode = 403;
        res.end(JSON.stringify({
          error: 'Must be logged in.'
        }));
      }
    });
  }
}

app.get('/',
  function(req, res) {
    var stream = mu.compileAndRender('index.mustache', {
      // Show the navbar only when logged in, since logged-out users can't
      // access the other pages (with the expection of shared block pages).
      logged_in_screen_name: req.user ? req.user.screen_name : null,
      csrf_token: req.session.csrf,
      hide_navbar: !req.user,
      follow_blocktogether: true
    });
    res.header('Content-Type', 'text/html');
    stream.pipe(res);
  });

app.get('/logout',
  function(req, res) {
    req.session = null;
    res.redirect('/logged-out');
  });

app.get('/logged-out',
  function(req, res) {
    var stream = mu.compileAndRender('logged-out.mustache', {
      csrf_token: req.session.csrf
    });
    res.header('Content-Type', 'text/html');
    stream.pipe(res);
  });

app.get('/settings',
  function(req, res) {
    var stream = mu.compileAndRender('settings.mustache', {
      logged_in_screen_name: req.user.screen_name,
      csrf_token: req.session.csrf,
      block_new_accounts: req.user.block_new_accounts,
      block_low_followers: req.user.block_low_followers,
      shared_blocks_key: req.user.shared_blocks_key,
      follow_blocktogether: req.user.follow_blocktogether
    });
    res.header('Content-Type', 'text/html');
    stream.pipe(res);
  });

app.post('/settings.json',
  function(req, res) {
    var user = req.user;
    return updateSettings(user, req.body).then(function(user) {
      res.header('Content-Type', 'application/json');
      res.end(JSON.stringify({
        share_blocks: !!user.shared_blocks_key,
        shared_blocks_key: user.shared_blocks_key,
        block_new_accounts: user.block_new_accounts,
        block_low_followers: user.block_low_followers,
        follow_blocktogether: user.follow_blocktogether
      }));
    });
  });

/**
 * Store the given settings on a BtUser, triggering any necessary side effects
 * (like generating a shared_blocks_key).
 * @param {BtUser} user User to modify.
 * @param {Object} settings JSON object with fields block_new_accounts,
 *   share_blocks, block_low_followers and follow_blocktogether.
 *   Absent fields will be treated as false.
 * @return {Promise.<BtUser>} promise
 */
function updateSettings(user, settings, callback) {
  // Setting: Block new accounts
  user.block_new_accounts = !!settings.block_new_accounts;
  // Setting: Block low followers
  user.block_low_followers = !!settings.block_low_followers;

  // Setting: Share blocks
  var new_share_blocks = settings.share_blocks;
  var old_share_blocks = user.shared_blocks_key != null;
  // Disable sharing blocks
  if (old_share_blocks && !new_share_blocks) {
    user.shared_blocks_key = null;
  }
  // Enable sharing blocks
  if (!old_share_blocks && new_share_blocks) {
    user.shared_blocks_key = (crypto.randomBytes(30).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_'));
  }

  // Setting: Follow @blocktogether
  var new_follow = settings.follow_blocktogether;
  var old_follow = user.follow_blocktogether;
  user.follow_blocktogether = !!new_follow;
  var friendship = function(action, source, sink) {
    logger.debug('/friendships/' + action, source, '-->', sink);
    twitter.friendships(action, { user_id: sink.uid },
      source.access_token, source.access_token_secret,
      function (err, results) {
        if (err) {
          logger.error(err);
        }
      });
  }
  // Box unchecked: Unfollow @blocktogether.
  if (old_follow && !new_follow) {
    // UserToFollow is a BtUser object representing @blocktogether, except
    // in test environment where it is a different user.
    friendship('destroy', user, userToFollow);
    // Unfollow back with the @blocktogether user.
    friendship('destroy', userToFollow, user);
  } else if (!old_follow && new_follow) {
    // Box checked: Follow @blocktogether.
    friendship('create', user, userToFollow);
    // Follow back with the @blocktogether user.
    friendship('create', userToFollow, user);
  }

  return user.save()
}

app.get('/actions',
  function(req, res, next) {
    return showActions(req, res, next);
  });

app.get('/my-blocks',
  function(req, res, next) {
    var show = showBlocks.bind(undefined, req, res, next,
      req.user, true /* ownBlocks */);
    // Each time a user reloads their own blocks page, fetch an updated copy. If
    // it takes too long, render anyhow. Only do this for first page or
    // non-paginated blocks, otherwise you increase chance of making the
    // pagination change with block update.
    if (!req.query.page) {
      remoteUpdateBlocks(req.user)
        .timeout(300 /* ms */)
        .then(show)
        .catch(show);
    } else {
      show();
    }
  });

/**
 * Show all the shared block lists a user subscribes to, and all the users that
 * subscribe to their shared block list, if applicable.
 */
app.get('/subscriptions',
  function(req, res, next) {
    var subscriptionsPromise = req.user.getSubscriptions({
      include: [{
        model: BtUser,
        as: 'Author'
      }]
    });
    var subscribersPromise = req.user.getSubscribers({
      include: [{
        model: BtUser,
        as: 'Subscriber'
      }]
    });
    return Q.spread([subscriptionsPromise, subscribersPromise],
      function(subscriptions, subscribers) {
        var templateData = {
          logged_in_screen_name: req.user.screen_name,
          csrf_token: req.session.csrf,
          subscriptions: subscriptions,
          subscribers: subscribers
        };
        res.header('Content-Type', 'text/html');
        mu.compileAndRender('subscriptions.mustache', templateData).pipe(res);
      }).catch(function(err) {
        logger.error(err);
        return next(new Error('Failed to get subscription data.'));
      });
  });

function validSharedBlocksKey(key) {
  return key && key.match(/^[A-Za-z0-9-_]{40,96}$/);
}

app.get('/show-blocks/:slug',
  function(req, res, next) {
    var slug = req.params.slug;
    if (!validSharedBlocksKey(slug)) {
      return next(new HttpError(400, 'Invalid parameters'));
    }
    BtUser
      .find({
        where: ['deactivatedAt IS NULL AND shared_blocks_key LIKE ?',
          slug.slice(0, 10) + '%']
      }).then(function(user) {
        // To avoid timing attacks that try and incrementally discover shared
        // block slugs, use only the first part of the slug for lookup, and
        // check the rest using constantTimeEquals. For details about timing
        // attacks see http://codahale.com/a-lesson-in-timing-attacks/
        if (user && constantTimeEquals(user.shared_blocks_key, slug)) {
          if (req.query.screen_name) {
            return searchBlocks(req, res, next, user);
          } else {
            return showBlocks(req, res, next, user, false /* ownBlocks */);
          }
        } else {
          return Q.reject(new HttpError(404, 'No such block list.'));
        }
      }).catch(next);
  });

/**
 * Subscribe to a block list based on a subscribe_on_signup stored in the
 * cookie session. This is used when a non-logged-on user clicks 'block all and
 * subscribe.'
 *
 * The rendered HTML will POST to /block-all.json with Javascript, with a special
 * parameter indicating that the shared_blocks_key from the session should be
 * used, and then deleted.
 *
 * Note: This does not check for an already-existing subscription, but that's
 * fine. Duplicate subscriptions result in some excess actions being enqueued
 * but are basically harmless.
 */
app.get('/subscribe-on-signup', function(req, res, next) {
  res.header('Content-Type', 'text/html');
  if (req.session.subscribe_on_signup) {
    var params = req.session.subscribe_on_signup;
    if (!(params.author_uid &&
          typeof params.author_uid === 'string' &&
          params.author_uid.match(/^[0-9]+$/))) {
      delete req.session.subscribe_on_signup;
      return next(new HttpError(400, 'Invalid parameters'));
    }
    BtUser.findById(params.author_uid)
      .then(function(author) {
      if (!author) {
        return Q.reject('No author found with uid =', params.author_uid);
      }
      mu.compileAndRender('subscribe-on-signup.mustache', {
        logged_in_screen_name: req.user.screen_name,
        csrf_token: req.session.csrf,
        author_screen_name: author.screen_name,
        author_uid: params.author_uid
      }).pipe(res);
    }).catch(function(err) {
      logger.error(err);
      next(new Error('Sequelize error.'));
    });
  } else {
    res.redirect('/subscriptions');
  }
});

var SEVEN_DAYS_IN_MILLIS = 7 * 86400 * 1000;
/**
 * Subscribe a user to the provided shared block list, and enqueue block actions
 * for all blocks currently on the list.
 * Expects two entries in JSON POST: author_uid and shared_blocks_key.
 */
app.post('/block-all.json',
  function(req, res, next) {
    res.header('Content-Type', 'application/json');
    var shared_blocks_key = req.body.shared_blocks_key;
    // Special handling for subscribe-on-signup: Get key from session,
    // delete it on success.
    if (req.body.subscribe_on_signup && req.session.subscribe_on_signup) {
      shared_blocks_key = req.session.subscribe_on_signup.key;
    }

    if (req.body.author_uid === req.user.uid) {
      return next(new HttpError(403, 'Cannot subscribe to your own block list.'));
    }

    // Some people create many new accounts and immediately subscribe them to
    // large block lists. This consumes DB space unnecessarily for accounts that
    // are likely to be suspended soon. Impose a minimum age requirement for
    // subscribing to discourage this.
    if (new Date() - req.user.TwitterUser.account_created_at < SEVEN_DAYS_IN_MILLIS) {
      return next(new HttpError(403,
        'Sorry, Twitter accounts less than seven days old cannot subscribe ' +
        'to block lists. Please try again in a week.'));
    }

    if (req.body.author_uid &&
        typeof req.body.author_uid === 'string' &&
        validSharedBlocksKey(shared_blocks_key)) {
      BtUser
        .find({
          where: {
            uid: req.body.author_uid,
            deactivatedAt: null
          }
        }).then(function(author) {
          logger.debug('Found author', author);
          // If the shared_blocks_key is valid, find the most recent BlockBatch
          // from that shared block list author, and copy each uid onto the
          // blocking user's list.
          if (author &&
              constantTimeEquals(author.shared_blocks_key, shared_blocks_key)) {
            logger.info('Subscribing', req.user, 'to list from', author);
            // Note: because of a uniqueness constraint on the [author,
            // subscriber] pair, this will fail if the subscription already
            // exists. But that's fine: It shouldn't be possible to create a
            // duplicate through the UI.
            Subscription.create({
              author_uid: author.uid,
              subscriber_uid: req.user.uid
            }).then(req.user.addSubscription.bind(req.user))
            .catch(function(err) {
              if (err.name !== 'SequelizeUniqueConstraintError') {
                logger.error(err);
              }
            });

            author.getBlockBatches({
              limit: 1,
              order: 'complete desc, currentCursor is null, updatedAt desc'
            }).then(function(blockBatches) {
              if (blockBatches && blockBatches.length > 0) {
                var batch = blockBatches[0];
                if (batch.size > maxSubscribeSize) {
                  next(new HttpError(400, 'Block list too big to subscribe.'));
                  return null;
                }
                return batch.getBlocks()
                  .then(function(blocks) {
                    var sinkUids = _.map(blocks, 'sink_uid');
                    return [sinkUids, actions.queueActions(
                      req.user.uid, sinkUids, Action.BLOCK,
                      Action.SUBSCRIPTION, author.uid)];
                  }).spread(function(sinkUids, actions) {
                    // On a successful subscribe-on-signup, delete the entries
                    // from the session.
                    if (req.body.subscribe_on_signup) {
                      delete req.session.subscribe_on_signup;
                    }
                    res.end(JSON.stringify({
                      block_count: sinkUids.length
                    }));
                  });
              } else {
                next(new HttpError(400, 'Empty block list.'));
                return null;
              }
            }).catch(function(err) {
              logger.error(err);
            });
          } else {
            next(new HttpError(400, 'Invalid shared block list id.'));
          }
          return null;
        }).catch(function(err) {
          logger.error(err);
        });
    } else {
      return next(new HttpError(400, 'Invalid parameters.'));
    }
  });

/**
 * Unsubscribe the authenticated user from a given shared block list, or
 * force-unsubscribe a given user from the authenticated user's shared
 * block list.
 *
 * Expects input of exactly one of author_uid or subscriber_uid, and will
 * unsubscribe authenticated user or force-unsubscribe another user depending on
 * which is present.
 */
app.post('/unsubscribe.json',
  function(req, res, next) {
    res.header('Content-Type', 'application/json');
    var params = NaN;
    // Important to require the client passes string ids. It's easy to
    // accidentally pass integer ids, which results in failing to use the MySQL
    // index. Also, it brings the possibility of mangling 64-bit integer ids.
    if (req.body.author_uid && typeof req.body.author_uid === 'string') {
      params = {
        author_uid: req.body.author_uid,
        subscriber_uid: req.user.uid
      };
    } else if (req.body.subscriber_uid && typeof req.body.subscriber_uid === 'string') {
      params = {
        author_uid: req.user.uid,
        subscriber_uid: req.body.subscriber_uid
      };
    } else {
      return new HttpError(400, 'Invalid parameters.');
    }
    logger.info('Removing subscription: ', params);
    Subscription.destroy({
      where: params
    }).then(function() {
      return actions.cancelUnsubscribed(params.subscriber_uid, params.author_uid);
    }).then(function() {
      res.end(JSON.stringify({}));
    }).catch(function(err) {
      logger.error(err);
      next(new Error('Unsubscribe failed.'));
    });
  });

/**
 * Given a JSON POST from a My Blocks page, enqueue the appropriate unblocks.
 */
app.post('/do-actions.json',
  function(req, res, next) {
    res.header('Content-Type', 'application/json');
    var types = {
      'block': Action.BLOCK,
      'unblock': Action.UNBLOCK,
      'mute': Action.MUTE
    };
    var type = types[req.body.type];
    if (req.body.list &&
        req.body.list.length &&
        req.body.list.length <= 5000 &&
        type) {
      actions.queueActions(
        req.user.uid, req.body.list, type,
        Action.SUBSCRIPTION, req.body.cause_uid);
      res.end('{}');
    } else {
      return next(new HttpError(400, 'Invalid parameters.'));
    }
  });


// Error handler. Must come after all routes.
app.use(function(err, req, res, next) {
  // If there was an authentication issue, clear all cookies so the user can try
  // logging in again.
  if (err.message === 'Failed to deserialize user out of session') {
    res.clearCookie('express:sess');
    res.clearCookie('express:sess.sig');
    res.clearCookie('uid');
    return res.redirect('/');
  }
  var message = err.message;
  res.statusCode = err.statusCode || 500;
  // Error codes in the 500 error range log stack traces because they represent
  // internal (unexpected) errors. Other errors only log the message, and only
  // at INFO level.
  var stack = '';
  var logLevel = 'INFO';
  if (err.stack) {
    var split = err.stack.split('\n');
    if (split.length > 1) {
      stack = split[1];
    }
  }
  if (res.statusCode >= 500) {
    stack = err.stack;
    logLevel = 'ERROR';
  }
  logger.log(logLevel, '' + res.statusCode, req.url, req.user, message, stack);
  res.format({
    html: function() {
      res.header('Content-Type', 'text/html');
      mu.compileAndRender('error.mustache', {
        logged_in_screen_name: req.user ? req.user.screen_name : null,
        error: message
      }).pipe(res);
    },
    json: function() {
      res.header('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: message
      }));
    }
  });
});

/**
 * Create pagination metadata object for items retrieved with findAndCountAll().
 * @param {Object} items Result of findAndCountAll() with count and rows fields.
 * @param {Number} perPage Number of items displayed per page.
 * @param {Number} currentPage Which page is currently being rendered, starts at 1.
 */
function getPaginationData(items, perPage, currentPage) {
  var pageCount = Math.ceil(items.count / perPage);
  // Pagination metadata to be returned:
  var paginationData = {
    item_count: items.count,
    item_rows: items.rows,
    // Are there enough items to paginate?
    paginate: pageCount > 1,
    // Array of objects (1-indexed) for use in pagination template.
    pages: _.range(1, pageCount + 1).map(function(pageNum) {
      return {
        page_num: pageNum,
        active: pageNum === currentPage
      };
    }),
    // Previous/next page indices for use in pagination template.
    previous_page: currentPage - 1 || false,
    next_page: currentPage === pageCount ? false : currentPage + 1,
    per_page: perPage
  }
  return paginationData;
}

/**
 * Get the appropriate number of blocks, plus the associated TwitterUsers
 * for screen names. Note that we don't do say `include: TwitterUsers`,
 * because that causes a JOIN, and the JOIN in combination with
 * limit/offset gets expensive for high page numbers. Instead we do the
 * blocks query first, then look up the TwitterUsers as a separate query.
 * For any blocks where the sink_uid does not yet exist in the TwitterUsers
 * table, return a fake TwitterUser with just a uid field.
 * For blocks where the sink_uid does exist in TwitterUsers, augment the
 * TwitterUser object with an `account_age` field.
 * @param {BlockBatch} blockBatch The batch from which to pull the blocks.
 * @param {Number} limit
 * @param {Number} offset
 * @return {Promise.<Array.<TwitterUser>>}
 */
function getBlockedUsers(blockBatch, limit, offset) {
  return Block.findAll({
    where: {
      blockBatchId: blockBatch.id
    },
    limit: limit,
    offset: offset
  }).then(function(blocks) {
    return [blocks, TwitterUser.findAll({
      where: {
        uid: {
          in: _.map(blocks, 'sink_uid')
        }
      }
    })];
  }).spread(function(blocks, users) {
    var indexedUsers = _.indexBy(users, 'uid');
    // Turn blocks into blocked TwitterUsers
    return blocks.map(function(block) {
      var user = indexedUsers[block.sink_uid];
      if (user) {
        block.TwitterUser = indexedUsers[block.sink_uid];
        // Add "N months ago" for rendering as account age.
        return _.extend(user, {
          account_age: timeago(user.account_created_at)
        });
      } else {
        // If the TwitterUser doesn't yet exist in the DB, we create a fake
        // one that just has a uid. This is important for template
        // expansion, below.
        return {
          uid: block.sink_uid
        }
      }
    });
  });
}

/**
 * Given a search by screen name, render a simple HTML page saying whether or
 * not btUser blocks that screen name. The work of looking up the screen name is
 * already done in another handler.
 */
function searchBlocks(req, res, next, btUser) {
  getLatestBlockBatch(btUser).then(function(blockBatch) {
    if (blockBatch && req.searched_user) {
      return blockBatch.getBlocks({
        where: {
          sink_uid: req.searched_user.uid
        }
      });
    } else {
      return Q.resolve(null);
    }
  }).then(function(blocks) {
    var templateData = {
      found: blocks && blocks.length > 0,
      source_screen_name: btUser.screen_name.toLowerCase(),
      sink_screen_name: req.query.screen_name.toLowerCase()
    }
    if (req.user) {
      templateData.logged_in_screen_name = req.user.screen_name;
    }
    mu.compileAndRender('search-blocks.mustache', templateData).pipe(res);
  }).catch(next);
}

function getLatestBlockBatch(btUser) {
  return BlockBatch.findOne({
    where: { source_uid: btUser.uid },
    // We prefer a the most recent complete BlockBatch, but if none is
    // available we will choose the most recent non-complete BlockBatch.
    // Additionally, for users with more than 75k blocks, updateBlocks will run
    // into the rate limit before finishing updating the blocks. The updating
    // will finish after waiting for the rate limit to lift, but in the meantime
    // it's possible to have multiple non-complete BlockBatches. In that case,
    // prefer ones with non-null currentCursors, i.e. those that have stored at
    // least some blocks.
    order: 'complete desc, currentCursor is null, updatedAt desc'
  });
}

/**
 * Render the block list for a given BtUser as HTML.
 */
function showBlocks(req, res, next, btUser, ownBlocks) {
  // The user viewing this page may not be logged in.
  var logged_in_screen_name = undefined;
  var user_uid = undefined;
  var user = req.user;
  if (user) {
    logged_in_screen_name = user.screen_name;
    user_uid = user.uid;
  }

  res.header('Content-Type', 'text/html');

  // For pagination:
  var currentPage = parseInt(req.query.page, 10) || 1,
      perPage = 500;
  if (currentPage < 1) {
    currentPage = 1;
  }

  return getLatestBlockBatch(btUser).then(function(blockBatch) {
    if (!blockBatch) {
      res.end('No blocks fetched yet. Please try again soon.');
      return Q.reject('No blocks fetched yet for ' + btUser.screen_name);
    } else {
      // Check whether the authenticated user is subscribed to this block list.
      var subscriptionPromise =
        req.user ? Subscription.find({
          where: {
            author_uid: btUser.uid,
            subscriber_uid: req.user.uid
          }
        }) : null;

      var blockedUsersPromise = getBlockedUsers(blockBatch,
        perPage, perPage * (currentPage - 1));

      // Find, count, and prepare block data for display:
      return [subscriptionPromise, blockBatch, blockedUsersPromise];
    }
  }).spread(function(subscription, blockBatch, blockedUsers) {
    var paginationData = getPaginationData({
      count: blockBatch.size || 0,
      rows: blockedUsers
    }, perPage, currentPage);
    var templateData = {
      updated: timeago(new Date(blockBatch.createdAt)),
      // The name of the logged-in user, for the nav bar.
      logged_in_screen_name: logged_in_screen_name,
      csrf_token: req.session.csrf,
      // The name of the user whose blocks we are viewing.
      author_screen_name: btUser.screen_name,
      // The uid of the user whose blocks we are viewing.
      author_uid: btUser.uid,
      // Base URL for appending pagination querystring.
      path_name: url.parse(req.url).pathname,
      shared_blocks_key: req.params.slug,
      // Whether this is /my-blocks (rather than /show-blocks/foo)
      own_blocks: ownBlocks,
      subscribed: !!subscription,
      too_big: paginationData.item_count > maxSubscribeSize,
      // uid of the authenticated user.
      user_uid: user_uid
    };
    // Merge pagination metadata with template-specific fields.
    _.extend(templateData, paginationData);
    mu.compileAndRender('show-blocks.mustache', templateData).pipe(res);
    return null;
  }).catch(function(err) {
    logger.error(err);
  });
}

/**
 * Render the action list for a given BtUser as HTML.
 */
function showActions(req, res, next) {
  // For pagination:
  var currentPage = parseInt(req.query.page, 10) || 1,
      perPage = 500;
  if (currentPage < 1) {
    currentPage = 1;
  }
  var whereClause = {
    source_uid: req.user.uid
  };
  if (req.query.screen_name) {
    if (req.searched_user) {
      whereClause.sink_uid = req.searched_user.uid;
    } else {
      return next(new HttpError(404, 'No actions found for @' + req.query.screen_name));
    }
  }
  // Find, count, and prepare action data for display. We avoid findAndCountAll
  // because of a Sequelize bug that does a join for the count because of the
  // include fields. That makes doing the count very slow for users with lots of
  // Actions.
  var countPromise = Action.count({
    where: whereClause
  });
  var actionsPromise = Action.findAll({
    where: whereClause,
    // We want to show pending actions before all other actions.
    // This FIELD statement will return 1 if status is 'pending',
    // otherwise 0.
    order: 'FIELD(status, ' + Action.PENDING + ') DESC, updatedAt DESC',
    limit: perPage,
    offset: perPage * (currentPage - 1),
    // Get the associated TwitterUser so we can display screen names.
    include: [{
      model: TwitterUser,
      required: false
    }, {
      model: BtUser,
      as: 'CauseUser',
      required: false
    }]
  });
  return Q.spread([countPromise, actionsPromise], function(count, actions) {
    var paginationData = getPaginationData({
      count: count,
      rows: actions
    }, perPage, currentPage);
    // Decorate the actions with human-friendly times
    paginationData.item_rows = paginationData.item_rows.map(function(action) {
      return _.extend(action, {
        prettyCreated: timeago(new Date(action.createdAt)),
        prettyUpdated: timeago(new Date(action.updatedAt)),
        status_str: action.status_str(),
        cause_str: action.cause_str(),
        type_str: action.type_str()
      });
    });
    var templateData = {
      logged_in_screen_name: req.user.screen_name,
      csrf_token: req.session.csrf,
      // Base URL for appending pagination querystring.
      path_name: url.parse(req.url).pathname
    };
    // Merge pagination metadata with template-specific fields.
    _.extend(templateData, paginationData);
    res.header('Content-Type', 'text/html');
    mu.compileAndRender('actions.mustache', templateData).pipe(res);
  }).catch(next);
}

function main() {
  var server = app.listen(config.port);

  process.on('SIGTERM', function () {
    logger.info('Shutting down.');
    setup.gracefulShutdown();
    server.close(function () {
      logger.info('Shut down succesfully.');
      process.exit(0);
    });
  });
  logger.info('Listening on', config.port);
}

main();

})();
