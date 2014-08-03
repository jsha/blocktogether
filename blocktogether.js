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
    setup = require('./setup'),
    actions = require('./actions'),
    updateBlocks = require('./update-blocks'),
    _ = require('sequelize').Utils._;

var config = setup.config,
    twitter = setup.twitter,
    BtUser = setup.BtUser,
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
              done(null, {
                profile: profile,
                accessToken: accessToken,
                accessTokenSecret: accessTokenSecret
              });
            });
        });
    }
  ));

  // used to serialize the user for the session
  passport.serializeUser(function(user, done) {
    done(null, JSON.stringify({
      id_str: user.profile._json.id_str,
      name: user.profile.username,
      accessToken: user.accessToken,
      accessTokenSecret: user.accessTokenSecret
    }));
  });

  // used to deserialize the user
  passport.deserializeUser(function(serialized, done) {
      done(null, JSON.parse(serialized));
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
         typeof(req.user.id_str) != u &&
         typeof(req.user.accessToken) != u &&
         typeof(req.user.accessTokenSecret) != u
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
    BtUser
      .find(req.user.id_str)
      .error(function(err) {
        console.log(err);
      }).success(function(btUser) {
        var stream = mu.compileAndRender('settings.mustache', {
          logged_in_screen_name: btUser.screen_name,
          block_new_accounts: btUser.block_new_accounts,
          shared_blocks_key: btUser.shared_blocks_key
        });
        res.header('Content-Type', 'text/html');
        stream.pipe(res);
      });
  });

app.post('/settings.json',
  function(req, res) {
    BtUser
      .find(req.user.id_str)
      .error(function(err) {
        console.log(err);
      }).success(function(user) {
        console.log('Updating settings for ', user.uid, req.body);
        if (typeof req.body.block_new_accounts !== 'undefined') {
          user.block_new_accounts = req.body.block_new_accounts;
        }
        if (typeof req.body.share_blocks !== 'undefined') {
          var new_share_blocks = req.body.share_blocks;
          var old_share_blocks = user.shared_blocks_key != null;
          // Disable sharing blocks
          if (old_share_blocks && !new_share_blocks) {
            user.shared_blocks_key = null;
          }
          // Enable sharing blocks
          if (!old_share_blocks && new_share_blocks) {
            user.shared_blocks_key = crypto.randomBytes(48).toString('hex');
          }
        }
        user
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
  });

app.get('/actions',
  function(req, res) {
    BtUser
      .find(req.user.id_str)
      .error(function(err) {
        console.log(err);
      }).success(function(user) {
        var stream = mu.compileAndRender('actions.mustache', {
          logged_in_screen_name: req.user.name
        });
        res.header('Content-Type', 'text/html');
        stream.pipe(res);
      });
  });

app.get('/my-blocks',
  function(req, res) {
    BtUser
      .find(req.user.id_str)
      .error(function(err) {
        console.log(err);
      }).success(function(user) {
        showBlocks(req, res, user);
      });
  });

app.get('/show-blocks/:slug',
  function(req, res) {
    BtUser
      .find({ where: { shared_blocks_key: req.params.slug } })
      .error(function(err) {
        console.log(err);
      }).success(function(user) {
        showBlocks(req, res, user);
      });
  });

app.post('/do-blocks.json',
  function(req, res) {
    res.header('Content-Type', 'application/json');
    if (req.body.list) {
      actions.queueBlocks(req.user.id_str, req.body.list);
      res.end("{}");
    } else {
      res.status(400);
      res.end(JSON.stringify({
        error: "Need to supply a list of ids"
      }));
    }
  });

/**
 * Render the block list for a given BtUser as HTML.
 */
function showBlocks(req, res, btUser) {
  // If we are rendering blocks for someone other than the logged-in user,
  // add a field `subject_screen_name' for the person we are viewing.
  var subject_screen_name = '';
  var own_blocks = true;
  // The user viewing this page may not be logged in.
  var logged_in_screen_name = undefined;
  if (req.user) {
    logged_in_screen_name = req.user.name;
  }
  if (logged_in_screen_name != btUser.screen_name) {
    subject_screen_name = btUser.screen_name;
    own_blocks = false;
  }
  twitter.blocks("ids", { skip_status: 1, cursor: -1 },
    btUser.access_token, btUser.access_token_secret,
    function(error, results) {
      if (error != null) {
        if (error.data) {
          var errorMessage = error.data;
        } else {
          var errorMessage = "Unknown error";
        }
        var stream = mu.compileAndRender('error.mustache', {
          error: errorMessage
        });
        res.header('Content-Type', 'text/html');
        stream.pipe(res);
      } else {
        var count = results.users ? results.users.length : results.ids.length;

        // Now create an Object that has an entry for every id, even if that
        // id didn't have details in the DB. A two-step process. First make
        // the array.
        var blockedUsers = {};
        results.ids.forEach(function(uid) {
          blockedUsers[uid] = {uid: uid};
        });
        // Then try to look up all those users in the DB and fill in the
        // structure.
        TwitterUser
          .findAll({ where:
            {uid: { in: results.ids }}})
          .success(function(users) {
            // Then fill it with DB results.
            users.forEach(function(twitterUser) {
              blockedUsers[twitterUser.uid] = twitterUser.dataValues;
            });
            // Now turn that Object into a list for use by Mustache.
            var blockedUsersList = Object.keys(blockedUsers).map(function(uid) {
              return blockedUsers[uid];
            });
            console.log(blockedUsersList);
            var templateData = {
              // The name of the logged-in user, for the nav bar.
              logged_in_screen_name: logged_in_screen_name,
              // The name of the user whose blocks we are viewing.
              subject_screen_name: subject_screen_name,
              block_count: count,
              more_than_5k: count === 5000,
              blocked_users: blockedUsersList,
              own_blocks: subject_screen_name == logged_in_screen_name
            };
            res.header('Content-Type', 'text/html');
            mu.compileAndRender('show-blocks.mustache', templateData).pipe(res);
          });
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
