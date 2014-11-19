'use strict';
(function() {
var fs = require('fs'),
    path = require('path'),
    tls = require('tls'),
    upnode = require('upnode'),
    Q = require('q'),
    twitterAPI = require('node-twitter-api'),
    log4js = require('log4js'),
    https = require('https'),
    _ = require('sequelize').Utils._;

/*
 * Config file should look like this:
 *
 *  {
 *    "consumerKey": "...",
 *    "consumerSecret": "...",
 *    "cookieSecret": "...",
 *  }
 */
var configDir = '/etc/blocktogether/';
var nodeEnv = process.env['NODE_ENV'] || 'development';
var configData = fs.readFileSync(configDir + 'config.json', 'utf8');
var config = JSON.parse(configData);

var twitter = new twitterAPI({
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret
});

log4js.configure(configDir + nodeEnv + '/log4js.json', {
  cwd: '/usr/local/blocktogether/shared/log'
});
// The logging category is based on the name of the running script, e.g.
// blocktogether, action, stream, etc.
var scriptName = path.basename(require.main.filename).replace(".js", "");
var logger = log4js.getLogger(scriptName);

// Once a second log how many pending HTTPS requests there are.
function logPendingRequests() {
  var requests = twitter.keepAliveAgent.requests;
  if (Object.keys(requests).length === 0) {
    logger.trace('Pending requests: 0');
  } else {
    for (var host in requests) {
      logger.trace('Pending requests to', host, ':', requests[host].length);
    }
  }
  var sockets = twitter.keepAliveAgent.sockets;
  if (Object.keys(sockets).length === 0) {
    logger.trace('Open sockets: 0');
  } else {
    for (host in sockets) {
      logger.trace('Open sockets to', host, ':', sockets[host].length);
    }
  }
}
setInterval(logPendingRequests, 5000);

var sequelizeConfigData = fs.readFileSync(
  configDir + 'sequelize.json', 'utf8');
var c = JSON.parse(sequelizeConfigData)[nodeEnv];
var Sequelize = require('sequelize'),
    sequelize = new Sequelize(c.database, c.username, c.password, _.extend(c, {
      logging: function(message) {
        logger.trace(message);
      }
    }));
sequelize
  .authenticate()
  .error(function(err) {
    logger.error('Unable to connect to the database:', err);
  });

// Use snake_case for model accessors because that's SQL style.
var TwitterUser = sequelize.define('TwitterUser', {
  uid: { type: Sequelize.STRING, primaryKey: true },
  friends_count: Sequelize.INTEGER,
  followers_count: Sequelize.INTEGER,
  profile_image_url_https: Sequelize.STRING,
  screen_name: Sequelize.STRING,
  name: Sequelize.STRING,
  deactivatedAt: Sequelize.DATE,
  lang: Sequelize.STRING,
  statuses_count: Sequelize.INTEGER,
  // NOTE: This field doesn't exactly match the name of the corresponding field
  // in the Twitter User object ('created_at'), because that matches too closely
  // the Sequelize built-in createdAt, and would be confusing.
  account_created_at: Sequelize.DATE
});

/**
 * BtUser, shorthand for Block Together User. Contains the user-related data
 * specific to Block Together, as opposed to their Twitter user profile.
 */
var BtUser = sequelize.define('BtUser', {
  uid: { type: Sequelize.STRING, primaryKey: true },
  // Technically we should get the screen name from the linked TwitterUser, but
  // it's much more convenient to have it right on the BtUser object.
  screen_name: Sequelize.STRING,
  // Twitter credentials
  access_token: Sequelize.STRING,
  access_token_secret: Sequelize.STRING,
  // If non-null, the slug with which the user's shared blocks can be accessed.
  shared_blocks_key: Sequelize.STRING,
  // True if the user has elected to block accounts < 7 days old that at-reply.
  // If this field is true, Block Together will monitor their User Stream to
  // detect such accounts.
  block_new_accounts: Sequelize.BOOLEAN,
  // True if the user has elected to block accounts with < 15 followers that at-reply.
  // If this field is true, Block Together will monitor their User Stream to
  // detect such accounts.
  block_low_followers: Sequelize.BOOLEAN,
  // Whether the user elected to follow @blocktogether from the settings screen.
  // This doesn't actually track their current following status, but we keep
  // track of it so that if they re-load the settings page it remembers the
  // value.
  follow_blocktogether: Sequelize.BOOLEAN,
  // When a user revokes the app, deactivates their Twitter account, or gets
  // suspended, we set deactivatedAt to the time we observed that fact.
  // Since each of those states can be undone, we periodically retry credentials
  // for 30 days, and if the user comes back we set deactivatedAt back to NULL.
  // Otherwise we delete the BtUser and related data.
  // Users with a non-null deactivatedAt will be skipped when updating blocks,
  // performing actions, and streaming.
  deactivatedAt: Sequelize.DATE
}, {
  instanceMethods: {
    /**
     * When logging a BtUser object, output just its screen name and uid.
     * To log all values, specify user.dataValues.
     */
    inspect: function() {
      return [this.screen_name, this.uid].join(" ");
    },

    /**
     * Ask Twitter to verify a user's credentials. If they not valid,
     * store the current time in user's deactivatedAt. If they are valid, clear
     * the user's deactivatedAt. Save the user to DB if it's changed.
     */
    verifyCredentials: function() {
      var user = this;
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
              logger.warn('User', user, 'deactivated or suspended.')
              user.deactivatedAt = new Date();
            } else {
              logger.warn('User', user, 'verify_credentials', err.statusCode);
            }
          } else {
            logger.info('User', user, 'has not revoked app or deactivated.');
            user.deactivatedAt = null;
          }
          if (user.changed()) {
            user.save().error(function(err) {
              logger.error(err);
            });
          }
      });
    }
  }
});
BtUser.hasOne(TwitterUser, {foreignKey: 'uid'});

var Subscription = sequelize.define('Subscription', {
  author_uid: Sequelize.STRING,
  subscriber_uid: Sequelize.STRING
});
BtUser.hasMany(Subscription, {foreignKey: 'author_uid', as: 'Subscribers'});
BtUser.hasMany(Subscription, {foreignKey: 'subscriber_uid', as: 'Subscriptions'});
Subscription.belongsTo(BtUser, {foreignKey: 'author_uid', as: 'Author'});
Subscription.belongsTo(BtUser, {foreignKey: 'subscriber_uid', as: 'Subscriber'});

/**
 * SharedBlocks differ from Blocks because they represent a long-term curated
 * set of blocks, and are meant to be explicitly shared. Blocks and BlockBatches
 * are a simple representation of the current state of a user's blocks based on
 * what the Twitter API returns.
 */
var SharedBlock = sequelize.define('SharedBlock', {
  author_uid: Sequelize.STRING,
  sink_uid: Sequelize.STRING
});
SharedBlock.belongsTo(BtUser, {foreignKey: 'author_uid'});
SharedBlock.belongsTo(TwitterUser, {foreignKey: 'sink_uid'});

var Block = sequelize.define('Block', {
  sink_uid: Sequelize.STRING,
  type: Sequelize.STRING
}, {
  timestamps: false
});

/**
 * Represents a batch of blocks fetched from Twitter, using cursoring.
 */
var BlockBatch = sequelize.define('BlockBatch', {
  source_uid: Sequelize.STRING,
  currentCursor: Sequelize.STRING,
  complete: Sequelize.BOOLEAN,
  size: Sequelize.INTEGER
});
BlockBatch.hasMany(Block, {onDelete: 'cascade'});
Block.belongsTo(TwitterUser, {foreignKey: 'sink_uid'});
BtUser.hasMany(BlockBatch, {foreignKey: 'source_uid', onDelete: 'cascade'});

/**
 * An action (block or unblock) that we performed on behalf of a user, or that
 * we observed the user perform from an external client (like twitter.com or
 * Twitter for Android).
 *
 * Pending actions are created when we intend to perform an action, and marked
 * 'done' once completed. External actions are marked with cause = 'external',
 * and are inserted with status = 'done' as soon as we observe them.
 */
var Action = sequelize.define('Action', {
  source_uid: Sequelize.STRING,
  sink_uid: Sequelize.STRING,
  type: Sequelize.STRING, // block or unblock
  status: { type: Sequelize.STRING, defaultValue: 'pending' },
  // A cause indicates why the action occurred, e.g. 'bulk-manual-block',
  // or 'new-account'. When the cause is another Block Together user,
  // e.g. in the bulk-manual-block case, the uid of that user is recorded in
  // cause_uid. When cause is 'new-account' or 'low-followers'
  // the cause_uid is empty.
  cause: Sequelize.STRING,
  cause_uid: Sequelize.STRING
});
// From a BtUser we want to get a list of Actions.
BtUser.hasMany(Action, {foreignKey: 'source_uid'});
// And from an Action we want to get a TwitterUser (to show screen name).
Action.belongsTo(TwitterUser, {foreignKey: 'sink_uid'});
// And also the screen name of the user who caused the action if it was from a
// subscription.
Action.belongsTo(BtUser, {foreignKey: 'cause_uid', as: 'CauseUser'});

_.extend(Action, {
  // Constants for the valid values of `status'.
  PENDING: 'pending',
  DONE: 'done',
  CANCELLED_FOLLOWING: 'cancelled-following',
  CANCELLED_SUSPENDED: 'cancelled-suspended',
  // If the action did not need to be performed because the source was already
  // blocking the sink.
  CANCELLED_DUPLICATE: 'cancelled-duplicate',
  // If a user has previously unblocked the target, the target should be immune
  // from future automated blocks.
  CANCELLED_UNBLOCKED: 'cancelled-unblocked',
  // You cannot block yourself.
  CANCELLED_SELF: 'cancelled-self',
  // When we find a suspended user, we put it in a deferred state to be tried
  // later.
  DEFERRED_TARGET_SUSPENDED: 'deferred-target-suspended',
  // When a user with pending actions is deactivated/suspended/revokes,
  // cancel those pending actions.
  CANCELLED_SOURCE_DEACTIVATED: 'cancelled-source-deactivated',

  // Constants for the valid values of 'type'.
  BLOCK: 'block',
  UNBLOCK: 'unblock',

  // Constants for the valid values of 'cause'
  BULK_MANUAL_BLOCK: 'bulk-manual-block', // 'Block all' from a shared list.
  NEW_ACCOUNT: 'new-account', // "Block new accounts"
  LOW_FOLLOWERS: 'low-followers', // "Block accounts with < 15 followers."
  SUBSCRIPTION: 'subscription', // Blocked because of a subscription.

  EXTERNAL: 'external' // Done byTwitter web or other app, and observed by BT.
});

// User to follow from settings page. In prod this is @blocktogether.
// Initially blank, and loaded asynchronously. It's unlikely the
// variable will be referenced before it is initialized.
var userToFollow = BtUser.build();
BtUser.find({
  where: {
    screen_name: config.userToFollow
  }
}).error(function(err) {
  logger.error(err);
}).success(function(user) {
  _.assign(userToFollow, user);
});

/**
 * A dnode client to call out to the update-blocks process to trigger block
 * updating when necessary. This ensures all processing of blocks (which can be
 * expensive) happens in a separate process from, e.g. the frontend or the
 * streaming daemon.
 */
var updateBlocksService = upnode.connect({
  createStream: function() {
    return tls.connect({
      host: 'localhost',
      port: 7000,
      // Provide a client certificate so the server knows it's us.
      cert: fs.readFileSync(configDir + 'rpc.crt'),
      key: fs.readFileSync(configDir + 'rpc.key'),
      // For validating the self-signed server cert
      ca: fs.readFileSync(configDir + 'rpc.crt'),
      // The name on the self-signed cert is verified; it's "blocktogether-rpc".
      servername: 'blocktogether-rpc'
    });
  }
});

// Call the updateBlocksService to update blocks for a user, and return a
// promise.
function remoteUpdateBlocks(user) {
  var deferred = Q.defer();
  logger.debug('Requesting block update for', user);
  // Note: We can't just call this once and store 'remote', because upnode
  // queues the request in case the remote server is down.
  updateBlocksService(function(remote) {
    remote.updateBlocksForUid(user.uid, function(result) {
      deferred.resolve(result);
    });
  });
  return deferred.promise;
}

module.exports = {
  Action: Action,
  Block: Block,
  BlockBatch: BlockBatch,
  BtUser: BtUser,
  TwitterUser: TwitterUser,
  Subscription: Subscription,
  SharedBlock: SharedBlock,
  config: config,
  configDir: configDir,
  logger: logger,
  sequelize: sequelize,
  twitter: twitter,
  userToFollow: userToFollow,
  remoteUpdateBlocks: remoteUpdateBlocks
};
})();
