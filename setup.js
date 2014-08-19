var fs = require('fs'),
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
 *    "dbUser": "...",
 *    "dbPass": "...",
 *    "dbHost": "..."
 *  }
 */
var configData = fs.readFileSync('/etc/blocktogether/config.json', 'utf8');
var config = JSON.parse(configData);

var twitter = new twitterAPI({
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret
});

var logger = log4js.getLogger({
  appenders: [
    { type: 'console' }
  ],
  replaceConsole: true
});
logger.setLevel('TRACE');

// Once a second log how many pending HTTPS requests there are.
function logPendingRequests() {
  var requests = https.globalAgent.requests;
  if (Object.keys(requests).length === 0) {
    logger.trace('Pending requests: 0');
  } else {
    for (host in requests) {
      logger.trace('Pending requests to', host, ':', requests[host].length);
    }
  }
  var sockets = https.globalAgent.sockets;
  if (Object.keys(sockets).length === 0) {
    logger.trace('Open sockets: 0');
  } else {
    for (host in sockets) {
      logger.trace('Open sockets to', host, ':', sockets[host].length);
    }
  }
}
setInterval(logPendingRequests, 5000);

var Sequelize = require('sequelize'),
    sequelize = new Sequelize('blocktogether', config.dbUser, config.dbPass, {
      logging: function(message) {
        logger.trace(message);
      },
      dialect: 'mysql',
      host: config.dbHost,
      port: 3306
    });
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
  name: Sequelize.STRING
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
  access_token: Sequelize.STRING,
  access_token_secret: Sequelize.STRING,
  shared_blocks_key: Sequelize.STRING,
  block_new_accounts: Sequelize.BOOLEAN,
  follow_blocktogether: Sequelize.BOOLEAN
});
BtUser.hasOne(TwitterUser);

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
  complete: Sequelize.BOOLEAN
});
BlockBatch.hasMany(Block, {onDelete: 'cascade'});
Block.belongsTo(TwitterUser, {foreignKey: 'sink_uid'});
BtUser.hasMany(BlockBatch, {foreignKey: 'source_uid', onDelete: 'cascade'});

/**
 * An action (block or unblock) that we perform on behalf of a user.
 * These are created when we intend to perform the action, and marked 'done'
 * once it's completed.
 */
var Action = sequelize.define('Action', {
  source_uid: Sequelize.STRING,
  sink_uid: Sequelize.STRING,
  type: Sequelize.STRING, // block or unblock
  status: { type: Sequelize.STRING, defaultValue: 'pending' }
});
BtUser.hasMany(Action, {foreignKey: 'source_uid'});
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
  DEFERRED_SUSPENDED: 'deferred-suspended',

  // Constants for the valid values of 'type'.
  BLOCK: 'block',
  UNBLOCK: 'unblock'
});

/**
 * A record of a user who was unblocked by a BlockTogether user.
 * Note: This is NOT parallel to the Blocks table because we cannot update
 * it at will from the REST API. Right now this table is only filled by
 * stream.js when it receives an unblock event, and entries are never removed
 * except manually by the user.
 *
 * Entries in this table are used to prevent re-blocking a user who has been
 * manually unblocked.
 */
var UnblockedUser = sequelize.define('UnblockedUser', {
  source_uid: Sequelize.STRING,
  sink_uid: Sequelize.STRING
});
BtUser.hasMany(UnblockedUser, {foreignKey: 'source_uid'});

sequelize
  .sync()
    .error(function(err) {
       logger.error(err);
    });

module.exports = {
  config: config,
  twitter: twitter,
  sequelize: sequelize,
  logger: logger,
  TwitterUser: TwitterUser,
  BtUser: BtUser,
  Block: Block,
  BlockBatch: BlockBatch,
  UnblockedUser: UnblockedUser,
  Action: Action
};
