var fs = require('fs'),
    twitterAPI = require('node-twitter-api')
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
var configData = fs.readFileSync('/etc/blocktogether/config.json', 'utf8');
var config = JSON.parse(configData);

var twitter = new twitterAPI({
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret
});

var Sequelize = require('sequelize'),
    sequelize = new Sequelize('blocktogether', config.dbUser, config.dbPass, {
      dialect: "mysql",
      host: config.dbHost,
      port:    3306,
    });
sequelize
  .authenticate()
  .complete(function(err) {
    if (!!err) {
      console.log('Unable to connect to the database:', err)
    } else {
      console.log('Sequelize onnection has been established successfully.')
    }
  })

// Use snake_case for model accessors because that's SQL style.
var TwitterUser = sequelize.define('TwitterUser', {
  uid: { type: Sequelize.STRING, primaryKey: true },
  friends_count: Sequelize.INTEGER,
  followers_count: Sequelize.INTEGER,
  profile_image_url_https: Sequelize.STRING,
  screen_name: Sequelize.STRING,
  name: Sequelize.STRING
});

var BtUser = sequelize.define('BtUser', {
  uid: { type: Sequelize.STRING, primaryKey: true },
  access_token: Sequelize.STRING,
  access_token_secret: Sequelize.STRING,
  shared_blocks_key: Sequelize.STRING,
  block_new_accounts: Sequelize.BOOLEAN
});

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

BlockBatch.hasMany(Block, {as: 'Blocks'});

sequelize
  .sync()
    .complete(function(err) {
       if (!!err) {
         console.log('An error occurred while creating the table:', err)
       } else {
         console.log('It worked!')
       }
    })

module.exports = {
  config: config,
  twitter: twitter,
  sequelize: sequelize,
  TwitterUser: TwitterUser,
  BtUser: BtUser,
  Block: Block,
  BlockBatch: BlockBatch
};
