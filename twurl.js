'use strict';
(function() {

var twitter = require('./setup').twitter,
    BtUser = require('./setup').BtUser;

BtUser.find({
  where: {
    screen_name: process.argv[2]
  }
}).then(function(user) {
    if (!user) {
      process.stdout.write('User ' + process.argv[2] + ' not found.\n');
      process.exit(1);
    }
    twitter.oa.get("https://api.twitter.com/1.1/" + process.argv[3],
      user.access_token, user.access_token_secret,
      function(err, data, response) {
      if (err) {
        process.stdout.write(JSON.stringify(err) + '\n');
      } else {
        var out = JSON.stringify(JSON.parse(data), null, 2);
        process.stdout.write(out + '\n');
      }
    });
  }).catch(function(err) {
    process.stdout.write(err + '\n');
  });
})();
