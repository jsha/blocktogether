var fs = require('fs'),
    twitterAPI = require('node-twitter-api'),
    log4js = require('log4js'),
    Sequelize = require('sequelize'),
    _ = Sequelize.Utils._
;

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
var env = process.env.NODE_ENV || 'development';
var configDir = '/etc/blocktogether/' + env;
var configData = fs.readFileSync(configDir + '/blocktogether.json', 'utf8');
var config = JSON.parse(configData);

var twitter = new twitterAPI({
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret
});

log4js.configure(configDir + '/log4js.json');
var logger = log4js.getLogger();
logger.setLevel('DEBUG');

var sequelizeConfig = fs.readFileSync(configDir + '/sequelize.json', 'utf8');
var sequelize = new Sequelize('blocktogether',
  _.extend(sequelizeConfig, {
      logging: function(message) {
        logger.debug(message);
      },
    }));
sequelize
  .authenticate()
  .error(function(err) {
    logger.error('Unable to connect to the database:', err);
  });

/**
 * A representation of Twitter's User object. We store only a subset of fields
 * that we care about.
 */
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

/**
 * A single block fetched from Twitter.
 */
var Block = sequelize.define('Block', {
  sink_uid: Sequelize.STRING,
  type: Sequelize.STRING
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
       logger.fatal(err);
       process.exit(1);
    })

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
