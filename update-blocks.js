var mysql = require('mysql'),
    twitterAPI = require('node-twitter-api'),
    fs = require('fs'),
    setup = require('./setup');

var mysqlConnection = setup.mysqlConnection;
var twitter = setup.twitter;

/**
 * For each user with stored credentials, fetch all of their blocked user ids,
 * and start filling the users table with data about those ids.
 */
function startQueries(mysqlConnection) {
  mysqlConnection.query('select uid, screen_name, access_token, access_token_secret ' +
    'from twitter_tokens natural join user;', function(err, rows) {
    if (err) {
      console.log(err);
    } else {
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var accessToken = row.access_token;
        var accessTokenSecret = row.access_token_secret;
        updateBlocks(row.uid, row.screen_name,
          row.access_token, row.access_token_secret);
      }
    }
  });
}

function updateBlocks(uid, screenName, accessToken, accessTokenSecret, cursor) {
  console.log('Fetching blocks for', uid, ' screen name ', screenName);
  // A function that can simply be called again to run this once more with an
  // update cursor.
  var getMore = updateBlocks.bind(null, uid, screenName,
    accessToken, accessTokenSecret);
  twitter.blocks("ids", {
      stringify_ids: true,
      cursor: cursor || -1
    },
    accessToken, accessTokenSecret,
    handleIds.bind(null, uid, getMore));
}

function handleIds(uid, getMore, err, results) {
  if (err) {
    console.log(err);
    return;
  }
  for (i = 0; i < results.ids.length; i++) {
    var blockedId = results.ids[i];
    // TODO: Update trigger so it doesn't alway overwrite with 'external'
    storeBlock = mysql.format(
      'replace into blocks (source_uid, sink_uid, `trigger`)' +
      ' values (?, ?, ?);',
      [uid, blockedId, 'external']);
    mysqlConnection.query(storeBlock, function(err, rows) {
      if (err) {
        console.log("Error saving blocks: " + err);
      }
    });
    var insertUser =
      mysql.format('insert ignore into user set uid = ?;', [blockedId]);
    console.log(insertUser);
    mysqlConnection.query(
      insertUser,
      function(err, rows) {
        if (err) {
          console.log("Error saving user: " + err);
        }
      });
  }
  if (results.next_cursor_str != '0') {
    console.log('Cursoring ', results.next_cursor_str);
    getMore(results.next_cursor_str);
  }
}


startQueries(mysqlConnection);
