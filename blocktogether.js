'use strict';
(function() {
// TODO: Add CSRF protection on POSTs
// TODO: Log off using GET allows drive-by logoff, fix that.
var express = require('express'), // Web framework
    url = require('url'),
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
  app.use('/static', express["static"](__dirname + '/static'));
  app.use('/', express["static"](__dirname + '/static'));

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
        access_token_secret: sessionUser.accessTokenSecret,
        deactivatedAt: null
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
  } else if (req.user) {
    next();
  } else {
    // Not authenticated, but should be.
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
      logged_in_screen_name: req.user ? req.user.screen_name : null,
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
    updateSettings(user, req.body, function(user) {
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
 * @param {Function} callback
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
  function(req, res, next) {
    showActions(req, res, next);
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
  function(req, res, next) {
    // HACK: Each time a user reloads their own blocks page, fetch an updated
    // copy of their blocks. This won't show up on the first render, since we
    // don't want to wait for results if it's a multi-page response, but it
    // means subsequent reloads will get the correct results.
    updateBlocks.updateBlocks(req.user);
    showBlocks(req, res, next, req.user, true /* ownBlocks */);
  });

app.get('/show-blocks/:slug',
  function(req, res, next) {
    BtUser
      .find({ where: { shared_blocks_key: req.params.slug } })
      .error(function(err) {
        logger.error(err);
      }).success(function(user) {
        if (user) {
          showBlocks(req, res, next, user, false /* ownBlocks */);
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
app.post('/do-actions.json',
  function(req, res) {
    res.header('Content-Type', 'application/json');
    var validTypes = {'block': 1, 'unblock': 1, 'mute': 1};
    if (req.body.list &&
        req.body.list.length &&
        req.body.list.length <= 5000 &&
        req.body.cause_uid &&
        req.body.cause_uid.match(/[0-9]{1,20}/) &&
        validTypes[req.body.type]) {
      actions.queueActions(
        req.user.uid, req.body.list, req.body.type,
        Action.BULK_MANUAL_BLOCK, req.body.cause_uid);
      res.end('{}');
    } else {
      res.status(400);
      res.end(JSON.stringify({
        error: 'Invalid parameters.'
      }));
    }
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
    next_page: currentPage === pageCount ? false : currentPage + 1
  }
  return paginationData;
}

/**
 * Render the block list for a given BtUser as HTML.
 */
function showBlocks(req, res, next, btUser, ownBlocks) {
  // The user viewing this page may not be logged in.
  var logged_in_screen_name = undefined;
  // For pagination:
  var currentPage = parseInt(req.query.page, 10) || 1,
      perPage = 5000;
  if (currentPage < 1) {
    currentPage = 1;
  }
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
      next(new Error('No blocks fetched yet. Please try again soon.'));
    } else {
      // Find, count, and prepare block data for display:
      Block.findAndCountAll({
        where: {
          blockBatchId: blockBatch.id
        },
        limit: perPage,
        offset: perPage * (currentPage - 1),
        include: [{
          model: TwitterUser,
          required: false
        }]
      }).error(function(err) {
        logger.error(err);
      }).success(function(blocks) {
        var paginationData = getPaginationData(blocks, perPage, currentPage);
        // Create a list of users that has at least a uid entry even if the
        // TwitterUser doesn't yet exist in our DB.
        paginationData.item_rows = paginationData.item_rows.map(function(block) {
          if (block.twitterUser) {
            var user = block.twitterUser;
            return _.extend(user, {
              account_age: timeago(user.account_created_at)
            });
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
          // Base URL for appending pagination querystring.
          path_name: url.parse(req.url).pathname,
          own_blocks: ownBlocks
        };
        // Merge pagination metadata with template-specific fields.
        _.extend(templateData, paginationData);
        res.header('Content-Type', 'text/html');
        mu.compileAndRender('show-blocks.mustache', templateData).pipe(res);
      });
    }
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
  // Find, count, and prepare action data for display:
  Action.findAndCountAll({
    where: {
      source_uid: req.user.uid
    },
    order: 'updatedAt DESC',
    limit: perPage,
    offset: perPage * (currentPage - 1),
    // Get the associated TwitterUser so we can display screen names.
    include: [{
      model: TwitterUser,
      required: false
    }]
  }).error(function(err) {
    logger.error(err);
  }).success(function(actions) {
    var paginationData = getPaginationData(actions, perPage, currentPage);
    // Decorate the actions with human-friendly times
    paginationData.item_rows = paginationData.item_rows.map(function(action) {
      return _.extend(action, {
        prettyCreated: timeago(new Date(action.createdAt)),
        prettyUpdated: timeago(new Date(action.updatedAt))
      });
    });
    var templateData = {
      logged_in_screen_name: req.user.screen_name,
      // Base URL for appending pagination querystring.
      path_name: url.parse(req.url).pathname
    };
    // Merge pagination metadata with template-specific fields.
    _.extend(templateData, paginationData);
    res.header('Content-Type', 'text/html');
    mu.compileAndRender('actions.mustache', templateData).pipe(res);
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
})();
