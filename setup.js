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

module.exports = {
  config: config,
  mysqlConnection: mysqlConnection,
  twitter: twitter
};
