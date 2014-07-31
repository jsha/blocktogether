var fs = require('fs'),
    mysql = require('mysql'),
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

var mysqlConnection = mysql.createConnection({
  host     : config.dbHost,
  user     : config.dbUser,
  password : config.dbPass,
  database : 'blocktogether'
});

mysqlConnection.connect(function(err) {
  if (err) {
    raise('error connecting to mysql: ' + err);
  }
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

var Settings = sequelize.define('Settings', {
  uid: { type: Sequelize.STRING, primaryKey: true },
  block_egg_mentions: Sequelize.BOOLEAN
});

sequelize
  .sync({ force: true })
    .complete(function(err) {
       if (!!err) {
         console.log('An error occurred while creating the table:', err)
       } else {
         console.log('It worked!')
       }
    })

module.exports = {
  config: config,
  mysqlConnection: mysqlConnection,
  twitter: twitter,
  sequelize: sequelize
};
