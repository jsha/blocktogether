// TODO: Add CSRF protection on POSTs
// TODO: Log off using GET allows drive-by logoff, fix that.
var express = require('express'), // Web framework
    bodyParser = require('body-parser'),
    cookieSession = require('cookie-session'),
    crypto = require('crypto'),
    mu = require('mu2'),          // Mustache.js templating
    passport = require('passport'),
    TwitterStrategy = require('passport-twitter').Strategy,
    timeago = require('timeago'),
    setup = require('./setup'),
    actions = require('./actions'),
    updateBlocks = require('./update-blocks'),
    _ = require('sequelize').Utils._;

var config = setup.config,
    twitter = setup.twitter,
    logger = setup.logger,
    userToFollow = setup.userToFollow,
    BtUser = setup.BtUser,
    Action = setup.Action,
    BlockBatch = setup.BlockBatch,
    Block = setup.Block,
    TwitterUser = setup.TwitterUser;

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
  app.use(passport.initialize());
  app.use(passport.session());
  app.use('/static', express.static(__dirname + '/static'));
  app.use('/', express.static(__dirname + '/static'));

  // Error handler.
  app.use(function(err, req, res, next){
    logger.error(err.stack);
    res.status(500).send('Something broke!');
  });

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
      accessToken: user.access_token,
      accessTokenSecret: user.access_token_secret
    }));
  });

  // Given the serialized uid and credentials, try to find the corresponding
  // user in the BtUsers table. If not found, that's fine - it might be a
  // logged-out path. Logged-out users are handed in requireAuthentication
  // below.
  passport.deserializeUser(function(serialized, done) {
    var sessionUser = JSON.parse(serialized);
    BtUser.find({
      where: {
        uid: sessionUser.uid,
        access_token: sessionUser.accessToken,
        access_token_secret: sessionUser.accessTokenSecret
      }
    }).error(function(err) {
      logger.error(err);
      // User not found in DB. Leave the user object undefined.
      done(null, undefined);
    }).success(function(user) {
      done(null, user);
    });
  });
  return app;
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
  var uid = profile._json.id_str;
  BtUser
    .findOrCreate({ uid: uid })
    .error(function(err) {
      logger.error(err);
      done(null, undefined);
    }).success(function(btUser) {
      TwitterUser
        .findOrCreate({ uid: uid })
        .error(function(err) {
          logger.error(err);
          done(null, undefined);
        }).success(function(twitterUser) {
          _.extend(twitterUser, profile._json);
          twitterUser.save().error(function(err) {
            logger.error(err);
          });

          btUser.screen_name = twitterUser.screen_name;
          btUser.access_token = accessToken;
          btUser.access_token_secret = accessTokenSecret;
          btUser.setTwitterUser(twitterUser);
          btUser.deactivatedAt = null;
          btUser
            .save()
            .error(function(err) {
              logger.error(err);
              done(null, undefined);
            }).success(function(btUser) {
              // When a user logs in, begin an fetch of their latest blocks.
              updateBlocks.updateBlocks(btUser);
              done(null, btUser);
            });
        });
    });
}

var app = makeApp();

/**
 * @return {Boolean} Whether the user is logged in
 */
function isAuthenticated(req) {
  var u = 'undefined';
  return typeof(req.user) != u &&
         typeof(req.user.uid) != u &&
         typeof(req.user.access_token) != u &&
         typeof(req.user.access_token_secret) != u;
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
      share_blocks: req.body.share_blocks,
      follow_blocktogether: req.body.follow_blocktogether
    };
  }
  passportAuthenticate(req, res, next);
});

function logInAndRedirect(req, res, next, user) {
  req.logIn(user, function(err) {
    if (err) {
      return next(err);
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
      if (err) {
        return next(err);
      } else if (!user) {
        return next(new Error('Declined app authorization.'));
      } else {
        // If this was a signup (vs a log on), set settings based on what the user
        // selected on the main page.
        if (req.session.signUpSettings) {
          updateSettings(user, req.session.signUpSettings, function(user) {
            delete req.session.signUpSettings;
            logInAndRedirect(req, res, next, user);
          });
        } else {
          // If this was a log on, don't set signUpSettings.
          logInAndRedirect(req, res, next, user);
        }
      }
    });
  passportCallbackAuthenticate(req, res, next);
});

function requireAuthentication(req, res, next) {
  if (req.url == '/' ||
      req.url == '/logged-out' ||
      req.url == '/favicon.ico' ||
      req.url == '/robots.txt' ||
      req.url.match('/show-blocks/.*') ||
      req.url.match('/static/.*')) {
    next();
  } else if (isAuthenticated(req)) {
    next();
  } else {
    res.format({
      html: function() {
        res.redirect('/');
      },
      json: function() {
        res.status(403);
        res.end(JSON.stringify({
          error: 'Must be logged in.'
        }));
      }
    });
  }
}

// Set some default security headers for every request.
app.get('/*', function(req, res, next) {
  res.header('X-Frame-Options', 'SAMEORIGIN');
  res.header('Content-Security-Policy', "default-src 'self';");
  next();
});
// All requests get passed to the requireAuthentication function; Some are
// exempted from authentication checks there.
app.all('/*', requireAuthentication);
// Check that POSTs were made via XMLHttpRequest, as a simple form of CSRF
// protection. This form of CSRF protection is somewhat more fragile than
// token-based CSRF protection, but has the advantage of simplicity.
// The X-Requested-With: XMLHttpRequest is automatically set by jQuery's
// $.ajax() method.
app.post('/*', function(req, res, next) {
  if (req.header('X-Requested-With') !== 'XMLHttpRequest') {
    res.status(400);
    res.end(JSON.stringify({
      error: 'Must provide X-Requested-With: XMLHttpRequest.'
    }));
  } else {
    next();
  }
});

app.get('/',
  function(req, res) {
    var stream = mu.compileAndRender('index.mustache', {
      // Show the navbar only when logged in, since logged-out users can't
      // access the other pages (with the expection of shared block pages).
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
    });
    res.header('Content-Type', 'text/html');
    stream.pipe(res);
  });

app.get('/settings',
  function(req, res) {
    var stream = mu.compileAndRender('settings.mustache', {
      logged_in_screen_name: req.user.screen_name,
      block_new_accounts: req.user.block_new_accounts,
      shared_blocks_key: req.user.shared_blocks_key,
      follow_blocktogether: req.user.follow_blocktogether
    });
    res.header('Content-Type', 'text/html');
    stream.pipe(res);
  });

app.post('/settings.json',
  function(req, res) {
    var user = req.user;
    updateSettings(user, req.body, function(user) {
      res.header('Content-Type', 'application/json');
      res.end(JSON.stringify({
        share_blocks: !!user.shared_blocks_key,
        shared_blocks_key: user.shared_blocks_key,
        block_new_accounts: user.block_new_accounts,
        follow_blocktogether: user.follow_blocktogether
      }));
    });
  });

/**
 * Store the given settings on a BtUser, triggering any necessary side effects
 * (like generating a shared_blocks_key).
 * @param {BtUser} user User to modify.
 * @param {Object} settings JSON object with fields block_new_accounts,
 *   share_blocks, and follow_blocktogether. Absent fields will be treated as
 *   false.
 * @param {Function} callback
 */
function updateSettings(user, settings, callback) {
  // Setting: Block new accounts
  user.block_new_accounts = !!settings.block_new_accounts;

  // Setting: Share blocks
  var new_share_blocks = settings.share_blocks;
  var old_share_blocks = user.shared_blocks_key != null;
  // Disable sharing blocks
  if (old_share_blocks && !new_share_blocks) {
    user.shared_blocks_key = null;
  }
  // Enable sharing blocks
  if (!old_share_blocks && new_share_blocks) {
    user.shared_blocks_key = crypto.randomBytes(48).toString('hex');
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

  user
    .save()
    .error(function(err) {
      logger.error(err);
    }).success(callback);
}

app.get('/actions',
  function(req, res) {
    req.user
      .getActions({
        order: 'updatedAt DESC',
        // Get the associated TwitterUser so we can display screen names.
        include: [{
          model: TwitterUser,
          required: false
        }]
      }).error(function(err) {
        logger.error(err);
      }).success(function(actions) {
        // Decorate the actions with human-friendly times
        actions = actions.map(function(action) {
          return _.extend(action, {
            prettyCreated: timeago(new Date(action.createdAt)),
            prettyUpdated: timeago(new Date(action.updatedAt))
          });
        });
        var stream = mu.compileAndRender('actions.mustache', {
          logged_in_screen_name: req.user.screen_name,
          actions: actions
        });
        res.header('Content-Type', 'text/html');
        stream.pipe(res);
      });
  });

app.get('/my-unblocks',
  function(req, res) {
    req.user
      .getUnblockedUsers()
      .error(function(err) {
        logger.error(err);
      }).success(function(unblockedUsers) {
        var stream = mu.compileAndRender('my-unblocks.mustache', {
          logged_in_screen_name: req.user.screen_name,
          unblocked_users: unblockedUsers
        });
        res.header('Content-Type', 'text/html');
        stream.pipe(res);
      });
  });

app.get('/my-blocks',
  function(req, res) {
    showBlocks(req, res, req.user, true /* ownBlocks */);
  });

app.get('/show-blocks/:slug',
  function(req, res) {
    BtUser
      .find({ where: { shared_blocks_key: req.params.slug } })
      .error(function(err) {
        logger.error(err);
      }).success(function(user) {
        if (user) {
          showBlocks(req, res, user, false /* ownBlocks */);
        } else {
          res.header('Content-Type', 'text/html');
          res.status(404);
          res.end('<h1>404 Page not found</h1>');
        }
      });
  });

/**
 * Given a JSON POST from a show-blocks page, enqueue the appropriate blocks.
 */
app.post('/do-blocks.json',
  function(req, res) {
    res.header('Content-Type', 'application/json');
    if (req.body.list && req.body.list.length &&
        req.body.list.length < 5000 &&
        req.body.cause_uid &&
        req.body.cause_uid.match(/[0-9]{1,20}/)) {
      actions.queueBlocks(
        req.user.uid, req.body.list, Action.BULK_MANUAL_BLOCK,
          req.body.cause_uid);
      res.end('{}');
    } else {
      res.status(400);
      res.end(JSON.stringify({
        error: 'Need to supply a list of ids'
      }));
    }
  });

function renderHtmlError(message) {
  var stream = mu.compileAndRender('error.mustache', {
    error: message
  });
  res.header('Content-Type', 'text/html');
  stream.pipe(res);
}

/**
 * Render the block list for a given BtUser as HTML.
 */
function showBlocks(req, res, btUser, ownBlocks) {
  // The user viewing this page may not be logged in.
  var logged_in_screen_name = undefined;
  if (req.user) {
    logged_in_screen_name = req.user.screen_name;
  }
  BlockBatch.find({
    where: { source_uid: btUser.uid },
    limit: 1,
    // We prefer a the most recent complete BlockBatch, but if none is
    // available we will choose the most recent non-complete BlockBatch.
    order: 'complete desc, createdAt desc'
  }).error(function(err) {
    logger.error(err);
  }).success(function(blockBatch) {
    if (!blockBatch) {
      renderHtmlError('No blocks fetched yet. Please try again soon.');
    } else {
      blockBatch.getBlocks({
        limit: 5000,
        include: [{
          model: TwitterUser,
          required: false
        }]
      }).error(function(err) {
        logger.error(err);
      }).success(function(blocks) {
        // Create a list of users that has at least a uid entry even if the
        // TwitterUser doesn't yet exist in our DB.
        var blockedUsersList = blocks.map(function(block) {
          if (block.twitterUser) {
            return block.twitterUser;
          } else {
            return {uid: block.sink_uid};
          }
        });
        var templateData = {
          updated: timeago(new Date(blockBatch.createdAt)),
          // The name of the logged-in user, for the nav bar.
          logged_in_screen_name: logged_in_screen_name,
          // The name of the user whose blocks we are viewing.
          author_screen_name: btUser.screen_name,
          // The uid of the user whose blocks we are viewing.
          author_uid: btUser.uid,
          // TODO: We could get the full count even when we are only displaying
          // 5000.
          block_count: blocks.length,
          theres_more: blocks.length === 5000,
          blocked_users: blockedUsersList,
          own_blocks: ownBlocks
        };
        res.header('Content-Type', 'text/html');
        mu.compileAndRender('show-blocks.mustache', templateData).pipe(res);
      });
    }
  });
}

if (process.argv.length > 2) {
  var socket = process.argv[2];
  logger.info('Starting server on UNIX socket ' + socket);
  app.listen(socket);
} else {
  logger.info('Starting server.');
  app.listen(config.port);
}
