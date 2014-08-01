var express = require('express'), // Web framework
    bodyParser = require('body-parser'),
    cookieSession = require('cookie-session'),
    mu = require('mu2'),          // Mustache.js templating
    passport = require('passport'),
    TwitterStrategy = require('passport-twitter').Strategy,
    setup = require('./setup');

var config = setup.config,
    twitter = setup.twitter,
    BtUser = setup.BtUser,
    TwitterUser = setup.TwitterUser;

// Look for templates here
mu.root = __dirname + '/templates';

function makeApp() {
  // Create the server
  var app = express();
  app.use(bodyParser());
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
        .complete(function(err, user) {
          if (!!err) {
            console.log(err);
          } else {
            user.access_token = accessToken;
            user.access_token_secret = accessTokenSecret;
            user.save()
            done(null, {
              profile: profile,
              accessToken: accessToken,
              accessTokenSecret: accessTokenSecret
            });
          }
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

// First, set some default security headers for every request.
app.get('/*', function(req, res, next) {
  res.header('X-Frame-Options', 'SAMEORIGIN');
  res.header('Content-Security-Policy', "default-src 'self';");
  next();
});

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

app.all('*', requireAuthentication);

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

function blocks(req, type, params, callback) {
  twitter.blocks(type, params,
    req.user.accessToken, req.user.accessTokenSecret,
    callback);
}

app.get('/show-blocks',
  function(req, res) {
    blocks(req, "ids", {
      skip_status: 1,
      cursor: -1
    }, function(error, results) {
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
        var stream = mu.compileAndRender('show-blocks.mustache', {
          screen_name: req.user.name,
          block_count: results.users ? results.users.length : results.ids.length,
          blocks: results.users,
          own_blocks: true,
          ids: ids
        });
        res.header('Content-Type', 'text/html');
        stream.pipe(res);
      }
    });
  });

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
