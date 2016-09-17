var system = require('system');
var user = system.env.BT_TEST_MAIN_USER;
var pass = system.env.BT_TEST_MAIN_PASS;

var checkBoxes = require('../lib/check_boxes.js');
var logout = require('../lib/logout.js');

var host = 'http://localhost:3000';

// Sometimes Twitter will immediately redirect back to the Block Together, but
// sometimes it will show an interstitial with an "Authorize" button even though
// the app is already authorized and the user is already logged in. So we make
// the click conditional on the presence of that form.
function clickAuthorize() {
  if (this.exists('form[id="oauth_form"]')) {
    return this.fill(
      'form[action*="https://api.twitter.com/oauth/authorize"]',
      {}, true);
  }
  return true;
}

// API docs: http://docs.casperjs.org/en/latest/testing.html
//
// The first argument is the name of the test, the second is the
// number of assertions occuring in the test, and the last is the test
// block itself.
casper.test.begin('Sign up and log on', 6, function(test) {
  casper.start(host, function() {
    test.assertExists('form[action*="/auth/twitter"]', "log on form is present");
    return this.fill('form[action*="/auth/twitter"]', {}, true);
  });

  casper.then(function() {
    return this.fill(
      'form[id="oauth_form"]',
      // NB: must use single quotes
      { 'session[username_or_email]': user, 'session[password]': pass }, true);
  });

  casper.waitForSelector('.container-fluid', function() {
    var checks = this.evaluate(checkBoxes);

    test.assertEqual(checks, [false, false, false, true], 'new account has default settings');

    this.click('#block_new_accounts');
  });

  casper.waitForSelector('.saved', function() {
    this.reload(function() {
      var checks = this.evaluate(checkBoxes);
      test.assertEqual(checks, [true, false, false, true], 'block_new_accounts was saved');
    });
  });

  casper.thenOpen(host + '/logout', function() {
    return true;
  });

  casper.waitForSelector('.log-on-link', function() {
    return this.fill('form[action*="/auth/twitter"]', {}, true);
  });

  casper.then(clickAuthorize);

  casper.waitForSelector('.container-fluid', function() {
    var checks = this.evaluate(checkBoxes);
    test.assertEqual(checks, [true, false, false, true], 'after logging out and in, settings are preserved');
  });

  casper.thenOpen(host + '/logout', function() {
    return true;
  });

  casper.waitForSelector('.log-on-link', function() {
    return this.click('.navbar-brand');
  });

  casper.then(function() {
    this.click('#share_blocks');
    return this.fill('form[action*="/auth/twitter"]', {}, true);
  });

  casper.then(clickAuthorize);

  casper.waitForSelector('.container-fluid', function() {
    var checks = this.evaluate(checkBoxes);
    test.assertEqual(checks, [false, false, true, true], 'signing up again overrides old settings');
    var text = this.getHTML();
    test.assert(text.indexOf('unlisted, unguessable') > -1, 'there is a valid show-blocks URL');
  });

  logout(casper, host);

  casper.run(function() {
    test.done();
  });
});
