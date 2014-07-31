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
var credentialsData = fs.readFileSync('/etc/blocktogether/config.json', 'utf8');
var credentials = JSON.parse(credentialsData);

var twitter = new twitterAPI({
    consumerKey: credentials.consumerKey,
    consumerSecret: credentials.consumerSecret
});

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

module.exports = {
  credentials: credentials,
  mysqlConnection: mysqlConnection,
  twitter: twitter
};
