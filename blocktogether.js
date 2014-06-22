var express = require('express'), // Web framework
    bodyParser = require('body-parser'),
    cookieSession = require('cookie-session'),
    mu = require('mu2'),          // Mustache.js templating
    passport = require('passport'),
    TwitterStrategy = require('passport-twitter').Strategy,
    mysql = require('mysql'),
    fs = require('fs');

var twitterAPI = require('node-twitter-api');
/*
 * Credentials file should look like this:
 *
 *  {
 *    "consumerKey": "...",
 *    "consumerSecret": "...",
 *    "cookieSecret": "...",
 *    "dbUser": "...",
 *    "dbPass": "...",
 *    "dbHost": "..."
 *  }
 */
var credentialsData = fs.readFileSync('/etc/blocktogether/credentials.json', 'utf8');
var credentials = JSON.parse(credentialsData);

var twitter = new twitterAPI({
    consumerKey: credentials.consumerKey,
    consumerSecret: credentials.consumerSecret
});

// Look for templates here
mu.root = __dirname + '/templates';

var mysqlConnection = mysql.createConnection({
  host     : credentials.dbHost,
  user     : credentials.dbUser,
  password : credentials.dbPass,
  database : 'blocktogether'
});

mysqlConnection.connect(function(err) {
  if (err) {
    raise('error connecting to mysql: ' + err);
  }
});

function makeApp() {
  // Create the server
  var app = express();
  app.use(bodyParser());
  app.use(cookieSession({
    keys: [credentials.cookieSecret],
    proxy: true /// XXX remove
  }));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(new TwitterStrategy({
      consumerKey: credentials.consumerKey,
      consumerSecret: credentials.consumerSecret,
      callbackURL: "http://localhost:3000/auth/twitter/callback"
    },
    // Callback on verified success.
    function(accessToken, accessTokenSecret, profile, done) {
      storeToken = mysql.format(
        'insert into twitter_tokens (uid, accessToken, accessTokenSecret)' +
        ' values (?, ?, ?) on duplicate key update;', [profile._json.id_str, accessToken, accessTokenSecret]);
      mysqlConnection.query(storeToken, function(err, rows) {
        if (err) {
          console.log("Error saving tokens: " + err);
        }
        done(null, {
          profile: profile,
          accessToken: accessToken,
          accessTokenSecret: accessTokenSecret
        });
      });
    }
  ));

  // used to serialize the user for the session
  passport.serializeUser(function(user, done) {
    done(null, JSON.stringify({
      id_str: user.profile._json.id_str,
      name: user.profile.displayName,
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

app.get('/login',
  function(req, res) {
    var stream = mu.compileAndRender('login.html', {});
    res.header('Content-Type', 'text/html');
    stream.pipe(res);
  });

function requireAuthentication(req, res, next) {
  if (req.url == '/' || req.url == '/login' || req.url.match('/static/.*')) {
    next();
  } else if (isAuthenticated(req)) {
    next();
  } else {
    res.redirect('/login');
  }
}

app.all('*', requireAuthentication);

app.get('/logged-in',
  function(req, res) {
    var stream = mu.compileAndRender('logged-in.html', {
      screen_name: req.user.name
    });
    res.header('Content-Type', 'text/html');
    stream.pipe(res);
  });

app.get('/logout',
  function(req, res) {
    req.session = null;
    res.redirect('/login');
  });

function blocks(req, type, params, callback) {
  twitter.blocks(type, params,
    req.user.accessToken, req.user.accessTokenSecret,
    callback);
}

app.get('/show-blocks',
  function(req, res) {
    blocks(req, "list", {skip_status: 1}, function(error, results) {
      var stream = mu.compileAndRender('show-blocks.html', {
        screen_name: req.user.name,
        blocks: results.users
      });
      res.header('Content-Type', 'text/html');
      stream.pipe(res);
    });
  });

app.use("/static", express.static(__dirname + '/static'));
app.use("/", express.static(__dirname + '/static'));

if (process.argv.length > 2) {
  var socket = process.argv[2];
  console.log("Starting server on UNIX socket " + socket);
  app.listen(socket);
} else {
  console.log("Starting server at http://localhost:3000/");
  app.listen(3000);
}
