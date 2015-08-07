'use strict';
(function() {
var fs = require('fs'),
    path = require('path'),
    tls = require('tls'),
    https = require('https'),
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
  cwd: '/data/blocktogether/shared/log'
});
// The logging category is based on the name of the running script, e.g.
// blocktogether, action, stream, etc.
var scriptName = path.basename(require.main ? require.main.filename : 'repl')
  .replace(".js", "");
var logger = log4js.getLogger(scriptName);

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

/**
 * A long-term store for Blocks from a given user. This is updated based on
 * diffs between BlockBatches, and can keep track of whether a given block is
 * shared, as well as keeping users on the list when they are deactivated.
 * In the future this may contain memoized fields from TwitterUser and Action,
 * like screen name, follower count, cause, and cause_uid. This will allow
 * efficient sorting and searching in shared block lists. This may also be a
 * good place to add a 'page' column for efficient pagination of large block
 * lists.
 *
 * Note: When diffing new blocks from the REST API against existing blocks in
 * the AnnotatedBlocks table, there's a possibility for inconsistency: If a
 * block arrived from the streaming API in the middle of fetching multiple
 * chunks in a BlockBatch, the BlockBatch won't have that block, so the diff
 * will make it look like there was an unblock. Solution: Each BlockBatch has a
 * createdAt and updatedAt. When doing a diff, ignore any AnnotatedBlocks with
 * createdAt after the BlockBatch's createdAt.
 *
 * Then there's the converse situation: an unblock arrives by the streaming API
 * in the middle of a long BlockBatch update. To fix this, we'll use paranoid
 * deletes in AnnotatedBlocks. When an unblock arrives, we don't delete the row,
 * we just set a deletedAt timestamp to non-null. Then, when doing diffs, we
 * treat rows with a deletedAt timestamp as if they were deleted, unless the
 * deletedAt is newer than the createdAt of the BlockBatch, in which case we
 * treat those rows as if they were still present, to avoid spurious block
 * events.
 *
 */
var AnnotatedBlock = sequelize.define('AnnotatedBlock', {
  source_uid: 'VARCHAR(20)',
  sink_uid: 'VARCHAR(20)',
  shared: Sequelize.BOOLEAN,
});
AnnotatedBlock.hasOne(Action);
AnnotatedBlock.belongsTo(BtUser, {foreignKey: 'source_uid'});
AnnotatedBlock.belongsTo(TwitterUser, {foreignKey: 'sink_uid'});

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
}).then(function(user) {
  _.assign(userToFollow, user);
}).catch(function(err) {
  logger.error(err);
});

var keepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000 * 1000
});

/**
 * Make a request to update-blocks to update blocks for a user.
 * @param {BtUser} user
 * @returns {Promise.<null>} A promise that resolves once blocks are updated.
 */
function remoteUpdateBlocks(user) {
  var deferred = Q.defer();
  logger.debug('Requesting block update for', user);
  var opts = {
    method: 'POST',
    agent: keepAliveAgent,
    host: config.updateBlocks.host,
    port: config.updateBlocks.port,
    // Provide a client certificate so the server knows it's us.
    cert: fs.readFileSync(configDir + 'rpc.crt'),
    key: fs.readFileSync(configDir + 'rpc.key'),
    // For validating the self-signed server cert
    ca: fs.readFileSync(configDir + 'rpc.crt'),
    rejectUnauthorized: false
  };
  var req = https.request(opts, function(res) {
    deferred.resolve();
  });
  req.on('error', function(err) {
    // Ignore ECONNRESET: The server will occasionally close the socket, which
    // is fine.
    if (err.code != 'ECONNRESET') {
      logger.error(err);
      deferred.reject(err);
    }
  });
  req.end(JSON.stringify({
    uid: user.uid,
    callerName: scriptName
  }));
  return deferred.promise;
}

function gracefulShutdown() {
}

process.on('uncaughtException', function(err) {
  logger.fatal('uncaught exception, shutting down: ', err);
  process.exit(133);
});

module.exports = {
  Action: Action,
  AnnotatedBlock: AnnotatedBlock,
  Block: Block,
  BlockBatch: BlockBatch,
  BtUser: BtUser,
  TwitterUser: TwitterUser,
  Subscription: Subscription,
  config: config,
  configDir: configDir,
  logger: logger,
  sequelize: sequelize,
  twitter: twitter,
  userToFollow: userToFollow,
  remoteUpdateBlocks: remoteUpdateBlocks,
  gracefulShutdown: gracefulShutdown
};
})();
