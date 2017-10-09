var system = require('system');

var checkBoxes = require('../lib/check_boxes.js');
var logout = require('../lib/logout.js');

var host = 'http://localhost:3000';

function cap(num) {
  casper.capture('screenshots/block-low-' + num + '.png');
}

casper.on('waitFor.timeout', function() {
    casper.capture('screenshots/timeout.png'); // this works
    this.log('A waitFor timed out', 'warning');
});

casper.test.begin('Block low follower users', 6, function(test) {
  var mainUser = system.env.BT_TEST_MAIN_USER;
  test.assert(mainUser !== undefined, "BT_TEST_MAIN_USER env var defined")
  var mainPass = system.env.BT_TEST_MAIN_PASS;
  test.assert(mainPass !== undefined, "BT_TEST_MAIN_PASS env var defined")
  var lowUser = system.env.BT_TEST_LOW_FOLLOWER_USER;
  test.assert(lowUser !== undefined, "BT_TEST_LOW_FOLLOWER_USER env var defined")
  var lowPass = system.env.BT_TEST_LOW_FOLLOWER_PASS;
  test.assert(lowPass !== undefined, "BT_TEST_LOW_FOLLOWER_PASS env var defined")

  casper.start(host, function() {
    cap('01')
    this.click('#block_low_followers');
    return this.fill('form[action*="/auth/twitter"]', {}, true);
  });

  casper.waitForSelector('#oauth_form', function() {
    cap('02')
    return this.fill(
      'form[id="oauth_form"]',
      // NB: must use single quotes
      { 'session[username_or_email]': mainUser, 'session[password]': mainPass }, true);
  });
  casper.debugHTML()

  casper.waitForSelector('.container-fluid', function() {
    cap('03')
    var checks = this.evaluate(checkBoxes);
    test.assertEqual(checks, [false, true, false, true], 'blocking low follower users');
  });

  casper.waitForSelector('.saved', function() {
    cap('04')
    console.log("saved")
  });

  // Sleep to ensure stream.js has rechecked for this user's settings
  // (refresh interval is 20 seconds)
  casper.wait(22000, function() {
    return true;
  })

  casper.thenOpen('https://twitter.com/logout', function() {
    return true;
  });

  casper.waitForSelector('.signout', function() {
    cap('05')
    return this.fill('form[action*="/logout"]', {}, true);
  });
  casper.waitForUrl(/https:\/\/twitter.com\/download.*/, function() {
    cap('06')
    return true;
  })

  // Random number so we don't get blocked for duplicate tweets
  casper.thenOpen('https://twitter.com/intent/tweet?text=@' +
                  mainUser + ' ive got ' + Math.random() + ' problems',
    function() {
      cap('07')
      return true;
    });

  casper.waitForSelector('.sign-in', function() {
    cap('08')
    return this.fill(
      'form[action*="https://twitter.com/intent/sessions"]',
      { 'session[username_or_email]': lowUser, 'session[password]': lowPass }, true);
  });

  casper.waitForUrl(/https:\/\/twitter.com\/intent\/tweet\/complete.*/)

  casper.wait(15000, function() {
    cap('10')
    casper.open('https://twitter.com/' + mainUser, function() {
      return true;
    });
  });

  casper.waitForSelector('.dropdown', function() {
    cap('11')
    test.assert(this.exists('.BlocksYouTimeline'), 'Low follower user is blocked');
  });

  logout(casper, host);

  casper.run(function() {
    test.done();
  });
});
