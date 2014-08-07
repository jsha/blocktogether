// TODO: Add CSRF protection on POSTs
// TODO: Login using GET allows session fixation, fix that
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
  app.use(cookieSession({
    keys: [config.cookieSecret],
    secureProxy: config.secureProxy
  }));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(new TwitterStrategy({
      consumerKey: config.consumerKey,
      consumerSecret: config.consumerSecret,
      callbackURL: config.callbackUrl
    },
    // Callback on verified success.
    function(accessToken, accessTokenSecret, profile, done) {
      var uid = profile._json.id_str;
      BtUser
        .findOrCreate({ uid: uid })
        .error(function(err) {
          console.log(err);
        }).success(function(btUser) {
          TwitterUser
            .findOrCreate({ uid: uid })
            .error(function(err) {
              console.log(err);
            }).success(function(twitterUser) {
              _.extend(twitterUser, profile._json);
              twitterUser.save();

              btUser.screen_name = twitterUser.screen_name;
              btUser.access_token = accessToken;
              btUser.access_token_secret = accessTokenSecret;
              btUser.setTwitterUser(twitterUser);
              btUser
                .save()
                .error(function(err) {
                  console.log(err);
                }).success(function(btUser) {
                  // When a user logs in, kick off an updated fetch of their
                  // blocks.
                  updateBlocks.updateBlocks(btUser);
                });
              done(null, btUser);
            });
        });
    }
  ));

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
        console.log(err);
        done(null, undefined);
      }).success(function(user) {
        done(null, user);
      })
  });
  return app;
}

var app = makeApp();

/**
 * @returns {Boolean} Whether the user is logged in
 */
function isAuthenticated(req) {
  var u = "undefined";
  return typeof(req.user) != u &&
         typeof(req.user.uid) != u &&
         typeof(req.user.access_token) != u &&
         typeof(req.user.access_token_secret) != u
}

// Redirect the user to Twitter for authentication.  When complete, Twitter
// will redirect the user back to the application at
//   /auth/twitter/callback
app.get('/auth/twitter', passport.authenticate('twitter'));

// Twitter will redirect the user to this URL after approval.  Finish the
// authentication process by attempting to obtain an access token.  If
// access was granted, the user will be logged in.  Otherwise,
// authentication has failed.
app.get('/auth/twitter/callback',
  passport.authenticate('twitter', { successRedirect: '/settings',
                                     failureRedirect: '/failed' }));

function requireAuthentication(req, res, next) {
  if (req.url == '/' ||
      req.url == '/logged-out' ||
      req.url.match('/show-blocks/.*') ||
      req.url.match('/static/.*')) {
    next();
  } else if (isAuthenticated(req)) {
    next();
  } else {
    res.redirect('/');
  }
}

// First, set some default security headers for every request.
app.get('/*', function(req, res, next) {
  res.header('X-Frame-Options', 'SAMEORIGIN');
  res.header('Content-Security-Policy', "default-src 'self';");
  next();
});
app.all('/*', requireAuthentication);
// Check that POSTs were made via XMLHttpRequest, as a simple form of CSRF
// protection. This form of CSRF protection is somewhat more fragile than
// token-based CSRF protection, but has the advantage of simplicity.
// The X-Requested-With: XMLHttpRequest is automatically set by jQuery's
// $.ajax() method.
app.post('/*', function(req, res, next) {
  if (req.header('X-Requested-With') !== "XMLHttpRequest") {
    res.status(400);
    res.end(JSON.stringify({
      error: "Must provide X-Requested-With: XMLHttpRequest."
    }));
  } else {
    next();
  }
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
      shared_blocks_key: req.user.shared_blocks_key
    });
    res.header('Content-Type', 'text/html');
    stream.pipe(res);
  });

app.post('/settings.json',
  function(req, res) {
    if (typeof req.body.block_new_accounts !== 'undefined') {
      req.user.block_new_accounts = req.body.block_new_accounts;
    }
    if (typeof req.body.share_blocks !== 'undefined') {
      var new_share_blocks = req.body.share_blocks;
      var old_share_blocks = req.user.shared_blocks_key != null;
      // Disable sharing blocks
      if (old_share_blocks && !new_share_blocks) {
        req.user.shared_blocks_key = null;
      }
      // Enable sharing blocks
      if (!old_share_blocks && new_share_blocks) {
        req.user.shared_blocks_key = crypto.randomBytes(48).toString('hex');
      }
    }
    req.user
      .save()
      .success(function(user) {
        res.header('Content-Type', 'application/json');
        res.end(JSON.stringify({
          share_blocks: true,
          shared_blocks_key: user.shared_blocks_key,
          block_new_accounts: true
        }));
      });
  });

app.get('/actions',
  function(req, res) {
    BtUser
      .find({
        where: { uid: req.user.uid },
        include: [Action]
      })
    req.user.getActions()
      .error(function(err) {
        console.log(err);
      }).success(function(actions) {
        // Decorate the actions with human-friendly times
        actions = actions.map(function (action) {
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

app.get('/my-blocks',
  function(req, res) {
    showBlocks(req, res, req.user, true /* ownBlocks */);
  });

app.get('/show-blocks/:slug',
  function(req, res) {
    BtUser
      .find({ where: { shared_blocks_key: req.params.slug } })
      .error(function(err) {
        console.log(err);
      }).success(function(user) {
        if (user) {
          showBlocks(req, res, user, false /* ownBlocks */);
        } else {
          res.header('Content-Type', 'application/html');
          res.status(404);
          res.end("<h1>404 Page not found</h1>");
        }
      });
  });

app.post('/do-blocks.json',
  function(req, res) {
    res.header('Content-Type', 'application/json');
    if (req.body.list) {
      actions.queueBlocks(req.user.uid, req.body.list);
      res.end("{}");
    } else {
      res.status(400);
      res.end(JSON.stringify({
        error: "Need to supply a list of ids"
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
    order: 'complete desc, createdAt desc',
  }).error(function(err) {
    console.log(err);
  }).success(function(blockBatch) {
    if (!blockBatch) {
      renderHtmlError("No blocks fetched yet. Please try again soon.");
    } else {
      blockBatch.getBlocks({
        limit: 5000,
        include: [{
          model: TwitterUser,
          required: false
        }]
      }).error(function(err) {
        console.log(err);
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
          subject_screen_name: btUser.screen_name,
          // TODO: We could get the full count even when we are only displaying
          // 5000.
          block_count: blocks.length,
          theres_more: blocks.length === 5000,
          blocked_users: blockedUsersList,
          own_blocks: ownBlocks
        };
        res.header('Content-Type', 'text/html');
        mu.compileAndRender('show-blocks.mustache', templateData).pipe(res);
      })
    }
  });
}

app.use("/static", express.static(__dirname + '/static'));
app.use("/", express.static(__dirname + '/static'));

if (process.argv.length > 2) {
  var socket = process.argv[2];
  console.log("Starting server on UNIX socket " + socket);
  app.listen(socket);
} else {
  console.log("Starting server.");
  app.listen(config.port);
}
