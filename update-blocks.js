var twitterAPI = require('node-twitter-api'),
    fs = require('fs'),
    setup = require('./setup');

var twitter = setup.twitter,
    BtUser = setup.BtUser,
    TwitterUser = setup.TwitterUser,
    BlockBatch = setup.BlockBatch,
    Block = setup.Block;

/**
 * For each user with stored credentials, fetch all of their blocked user ids,
 * and start filling the users table with data about those ids.
 */
function startQueries() {
  BtUser
    .findAll()
    .complete(function(err, users) {
      if (!!err) {
        console.log(err);
        return;
      }
      users.forEach(function(user) {
        BlockBatch.create({
          source_uid: user.uid
        }).error(function(err) {
          console.log(err);
        }).success(function(blockBatch) {
          updateBlocks(blockBatch, user.access_token, user.access_token_secret);
        });
      });
    });
}

function updateBlocks(blockBatch, accessToken, accessTokenSecret, cursor) {
  console.log('Fetching blocks for', blockBatch.source_uid);
  // A function that can simply be called again to run this once more with an
  // update cursor.
  var getMore = updateBlocks.bind(null, blockBatch, accessToken, accessTokenSecret);
  var currentCursor = cursor || -1;
  twitter.blocks("ids", {
      // Stringify ids is very important, or we'll get back numeric ids that
      // will get subtly mangled by JS.
      stringify_ids: true,
      cursor: currentCursor,
    },
    accessToken, accessTokenSecret,
    handleIds.bind(null, blockBatch, currentCursor, getMore));
}

function handleIds(blockBatch, currentCursor, getMore, err, results) {
  if (err) {
    if (err.statusCode === 429) {
      console.log('Rate limited. Trying again in 15 minutes.');
      setTimeout(function() {
        getMore(currentCursor);
      }, 15 * 60 * 1000);
    } else {
      console.log(err);
    }
    return;
  }

  // Update the current cursor stored with the blockBatch. Not currently used,
  // but may be useful to resume fetching blocks across restarts of this script.
  blockBatch.currentCursor = currentCursor;
  blockBatch.save();

  // First, add any new uids to the TwitterUser table if they aren't already
  // there (note ignoreDuplicates so we don't overwrite fleshed-out users).
  // Note: even though the field name is 'ids', these are actually stringified
  // ids because we specified that in the request.
  var usersToCreate = results.ids.map(function(id) {
    return {uid: id};
  });
  TwitterUser.bulkCreate(usersToCreate, { ignoreDuplicates: true });

  // Now we create block entries for all the blocked ids. Note: setting
  // BlockBatchId explicitly here doesn't show up in the documentation,
  // but it seems to work.
  var blocksToCreate = results.ids.map(function(id) {
    return {
      sink_uid: id,
      BlockBatchId: blockBatch.id
    };
  });
  Block.bulkCreate(blocksToCreate);

  // Check whether we're done or next to grab the items at the next cursor.
  if (results.next_cursor_str === '0') {
    console.log('Finished fetching blocks for user ', blockBatch.source_uid);
  } else {
    console.log('Cursoring ', results.next_cursor_str);
    getMore(results.next_cursor_str);
  }
}


startQueries();
