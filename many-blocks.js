var mysql = require('mysql'),
    twitterAPI = require('node-twitter-api'),
    fs = require('fs'),
    setup = require('./setup');

var credentials = setup.credentials;
var mysqlConnection = setup.mysqlConnection;
var twitter = setup.twitter;

mysqlConnection.query('select uid, accessToken, accessTokenSecret ' +
  'from twitter_tokens where uid = "123456789";', function(err, rows) {
  var accessToken = rows[0].accessToken;
  var accessTokenSecret = rows[0].accessTokenSecret;
  var randos = fs.readFileSync('to-block.txt').toString().split("\n");
  var chosenRando = randos[Math.floor(Math.random()*randos.length)];
  var i = 0;
  var blockAndNext = function() {
    twitter.blocks("create", {screen_name: randos[i++], skip_status: 1}, accessToken, accessTokenSecret, function(error, results) {
      if (error == null) {
        console.log("Blocked " + results.id);
      } else {
        console.log("Error blocking: " + error);
      }
      setTimeout(blockAndNext, 100);
    });
  }
  blockAndNext();
  mysqlConnection.destroy();
});
