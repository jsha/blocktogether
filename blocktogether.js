'use strict';
(function() {
// TODO: Add CSRF protection on POSTs
// TODO: Log off using GET allows drive-by logoff, fix that.
var cluster = require('cluster'),
    express = require('express'), // Web framework
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
    _ = require('sequelize').Utils._;

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

  passport.use(new TwitterStrategy({
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret,
    callbackURL: config.callbackUrl,
    // Normally Passport makes a second request on login to get a user's full
    // profile, but we only need screen name, so skip the request.
    skipExtendedUserProfile: true
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
  // logged-out path. Logged-out users are handed in requireAuthentication
  // below.
  passport.deserializeUser(function(serialized, done) {
    var sessionUser = JSON.parse(serialized);
    BtUser.find({
      where: {
        uid: sessionUser.uid,
        deactivatedAt: null
      }
    }).error(function(err) {
      logger.error(err);
      // User not found in DB. Leave the user object undefined.
      done(null, undefined);
    }).success(function(user) {
      // It's probably unnecessary to do constant time compare on these, since
      // the HMAC on the session cookie should prevent an attacker from
      // submitting arbitrary valid sessions, but this is nice defence in depth
      // against timing attacks in case the cookie secret gets out.
      if (user &&
          constantTimeEquals(user.access_token, sessionUser.accessToken)) {
        done(null, user);
      } else {
        logger.error('Incorrect access token in session for', user);
        done(null, undefined);
      }
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
  logger.info(profile);
  var uid = profile.id;
  var screen_name = profile.username;

  BtUser
    .findOrCreate({ uid: uid })
    .then(function(btUser) {
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
    }).then(function(btUser) {
      remoteUpdateBlocks(btUser);
      done(null, btUser);
    }).catch(function(err) {
      logger.error(err);
      done(null, undefined);
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
    Q.spread([subscriptionsPromise, subscribersPromise],
      function(subscriptions, subscribers) {
        var templateData = {
          logged_in_screen_name: req.user.screen_name,
          subscriptions: subscriptions,
          subscribers: subscribers
        };
        res.header('Content-Type', 'text/html');
        mu.compileAndRender('subscriptions.mustache', templateData).pipe(res);
      }).catch(function(err) {
        logger.error(err);
        next(new Error('Failed to get subscription data.'));
      });
  });

function validSharedBlocksKey(key) {
  return key && key.match(/^[a-f0-9]{96}$/);
}

app.get('/show-blocks/:slug',
  function(req, res, next) {
    var slug = req.params.slug;
    if (!validSharedBlocksKey(slug)) {
      res.status(404).end('No such block list.');
    }
    BtUser
      .find({
        where: ['deactivatedAt IS NULL AND shared_blocks_key LIKE ?',
          slug.slice(0, 10) + '%']
      }).error(function(err) {
        logger.error(err);
      }).success(function(user) {
        // To avoid timing attacks that try and incrementally discover shared
        // block slugs, use only the first part of the slug for lookup, and
        // check the rest using constantTimeEquals. For details about timing
        // attacks see http://codahale.com/a-lesson-in-timing-attacks/
        if (user && constantTimeEquals(user.shared_blocks_key, slug)) {
          showBlocks(req, res, next, user, false /* ownBlocks */);
        } else {
          res.status(404).end('No such block list.');
        }
      });
  });

/**
 * Subscribe a user to the provided shared block list, and enqueue block actions
 * for all blocks currently on the list.
 * Expects two entries in JSON POST: author_uid and shared_blocks_key.
 */
app.post('/block-all.json',
  function(req, res, next) {
    res.header('Content-Type', 'application/json');
    var validTypes = {'block': 1, 'unblock': 1, 'mute': 1};
    var shared_blocks_key = req.body.shared_blocks_key;
    if (req.body.author_uid &&
        req.body.author_uid !== req.user.uid &&
        validSharedBlocksKey(shared_blocks_key)) {
      BtUser
        .find({
          where: {
            uid: req.body.author_uid,
            deactivatedAt: null
          }
        }).error(function(err) {
          logger.error(err);
        }).success(function(author) {
          logger.debug('Found author', author);
          // If the shared_blocks_key is valid, find the most recent BlockBatch
          // from that share block list author, and copy each uid onto the
          // blocking user's list.
          if (author &&
              constantTimeEquals(author.shared_blocks_key, shared_blocks_key)) {
            // Note: because of a uniqueness constraint on the [author,
            // subscriber] pair, this will fail if the subscription already
            // exists. But that's fine: It shouldn't be possible to create a
            // duplicate through the UI.
            Subscription.create({
              author_uid: author.uid,
              subscriber_uid: req.user.uid
            }).then(req.user.addSubscription.bind(req.user))
            .catch(function(err) {
              logger.error(err);
            });

            author.getBlockBatches({
              limit: 1,
              order: 'complete desc, currentCursor is null, updatedAt desc'
            }).error(function(err) {
              logger.error(err);
            }).success(function(blockBatches) {
              if (blockBatches && blockBatches.length > 0) {
                blockBatches[0].getBlocks()
                  .error(function(err) {
                    logger.error(err);
                  }).success(function(blocks) {
                    var sinkUids = _.pluck(blocks, 'sink_uid');
                    actions.queueActions(
                      req.user.uid, sinkUids, Action.BLOCK,
                      Action.BULK_MANUAL_BLOCK, author.uid);
                    res.end(JSON.stringify({
                      block_count: sinkUids.length
                    }));
                  });
              } else {
                next(new Error('Empty block list.'));
              }
            });
          } else {
            next(new Error('Invalid shared block list id.'));
          }
        });
    } else {
      res.status(400);
      res.end(JSON.stringify({
        error: 'Invalid parameters.'
      }));
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
    if (req.body.author_uid) {
      params = {
        author_uid: req.body.author_uid,
        subscriber_uid: req.user.uid
      };
    } else if (req.body.subscriber_uid) {
      params = {
        author_uid: req.user.uid,
        subscriber_uid: req.body.subscriber_uid
      };
    } else {
      return next(new Error('Invalid parameters.'));
    }
    Subscription.destroy(params).then(function() {
      res.end(JSON.stringify({}));
    }).catch(function(err) {
      next(new Error('Sequelize error.'));
    });
  });

/**
 * Given a JSON POST from a My Blocks page, enqueue the appropriate unblocks.
 */
app.post('/do-actions.json',
  function(req, res) {
    res.header('Content-Type', 'application/json');
    var validTypes = {'block': 1, 'unblock': 1, 'mute': 1};
    if (req.body.list &&
        req.body.list.length &&
        req.body.list.length <= 5000 &&
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


// Error handler. Must come after all routes.
app.use(function(err, req, res, next){
  logger.error(err.stack);
  res.status(500);
  res.header('Content-Type', 'text/html');
  mu.compileAndRender('error.mustache', {
    error: err.message
  }).pipe(res);
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

  BlockBatch.find({
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
  }).then(function(blockBatch) {
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

      var blocksPromise = Block.findAll({
        where: {
          blockBatchId: blockBatch.id
        },
        limit: perPage,
        offset: perPage * (currentPage - 1),
        include: [{
          model: TwitterUser,
          required: false
        }]
      });

      // Find, count, and prepare block data for display:
      return [subscriptionPromise, blockBatch, blocksPromise];
    }
  }).spread(function(subscription, blockBatch, blocks) {
    var paginationData = getPaginationData({
      count: blockBatch.size || 0,
      rows: blocks
    }, perPage, currentPage);
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
      shared_blocks_key: req.params.slug,
      // Whether this is /my-blocks (rather than /show-blocks/foo)
      own_blocks: ownBlocks,
      subscribed: !!subscription,
      // uid of the authenticated user.
      user_uid: user_uid
    };
    // Merge pagination metadata with template-specific fields.
    _.extend(templateData, paginationData);
    mu.compileAndRender('show-blocks.mustache', templateData).pipe(res);
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
  // Find, count, and prepare action data for display. We avoid findAndCountAll
  // because of a Sequelize bug that does a join for the count because of the
  // include fields. That makes doing the count very slow for users with lots of
  // Actions.
  var whereClause = {
    source_uid: req.user.uid
  };
  var countPromise = Action.count({
    where: whereClause
  });
  var actionsPromise = Action.findAll({
    where: whereClause,
    // We want to show pending actions before all other actions.
    // This FIELD statement will return 1 if status is 'pending',
    // otherwise 0.
    order: 'FIELD(status, "pending") DESC, updatedAt DESC',
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

  Q.spread([countPromise, actionsPromise], function(count, actions) {
    var paginationData = getPaginationData({
      count: 1000,
      rows: actions
    }, perPage, currentPage);
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
  }).catch(function(err) {
    logger.error(err);
  });
}

if (cluster.isMaster) {
  logger.info('Starting workers.');
  for (var i = 0; i < 2; i++) {
    cluster.fork();
  }

  cluster.on('exit', function(worker, code, signal) {
    logger.error('worker', worker.process.pid, 'died, resurrecting.');
    cluster.fork();
  });
} else {
  app.listen(config.port);
  logger.info('Worker', cluster.worker.id, 'up.');
}


})();
