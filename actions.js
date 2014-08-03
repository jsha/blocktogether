/**
 * Script to block a list of screen names using credentials for a given user id
 */
var twitterAPI = require('node-twitter-api'),
    fs = require('fs'),
    setup = require('./setup');

var twitter = setup.twitter,
    BtUser = setup.BtUser,
    Action = setup.Action;

/**
 * Given a list of uids, enqueue them all in the Actions table.
 */
function queueBlocks(source_uid, list) {
  list.forEach(function(sink_uid) {
    Action.create({
      source_uid: source_uid,
      sink_uid: sink_uid,
      type: "block"
    }).error(function(err) {
      console.log(err);
    });
  });
}

Action
  .findAll({
    where: { status: 'pending', },
    order: 'updatedAt ASC',
    include: [BtUser]
  }).success(function(actions) {
    console.log(actions);
  });

module.exports = {
  queueBlocks: queueBlocks
};
