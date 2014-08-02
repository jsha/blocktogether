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
              btUser.save();
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
  passport.authenticate('twitter', { successRedirect: '/logged-in',
                                     failureRedirect: '/failed' }));

function requireAuthentication(req, res, next) {
  if (req.url == '/' || req.url == '/logged-out' || req.url.match('/static/.*')) {
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

app.get('/logged-in',
  function(req, res) {
    var stream = mu.compileAndRender('logged-in.mustache', {
      screen_name: req.user.name
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
    BtUser
      .find(req.user.id_str)
      .error(function(err) {
        console.log(err);
      }).success(function(btUser) {
        console.log('btu ', btUser.dataValues);
        console.log({
          screen_name: btUser.screen_name,
          block_new_accounts: btUser.block_new_accounts,
          shared_blocks_key: btUser.shared_blocks_key
        });
        var stream = mu.compileAndRender('settings.mustache', {
          screen_name: btUser.screen_name,
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
          var old_share_blocks = (user.shared_blocks_key !== '');
          console.log(old_share_blocks, new_share_blocks);
          // Disable sharing blocks
          if (old_share_blocks && !new_share_blocks) {
            user.shared_blocks_key = '';
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

app.get('/show-blocks',
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

/**
 * Render the block list for a given BtUser as HTML.
 */
function showBlocks(req, res, btUser) {
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
        var ids = results.ids.map(function(id) {
          return { id: id };
        });
        var count = results.users ? results.users.length : results.ids.length;
        var stream = mu.compileAndRender('show-blocks.mustache', {
          // The name of the logged-in user, for the nav bar.
          screen_name: req.user.name,
          // The name of the user whose blocks we are viewing.
          subject_screen_name: btUser.screen_name,
          block_count: count,
          more_than_5k: count === 5000,
          blocks: results.users,
          own_blocks: true,
          ids: ids
        });
        res.header('Content-Type', 'text/html');
        stream.pipe(res);
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
