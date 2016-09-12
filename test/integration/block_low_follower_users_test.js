var system = require('system');
var mainUser = system.env.BT_TEST_MAIN_USER;
var mainPass = system.env.BT_TEST_MAIN_PASS;
var lowUser = system.env.BT_TEST_LOW_FOLLOWER_USER;
var lowPass = system.env.BT_TEST_LOW_FOLLOWER_PASS;

var host = 'http://localhost:3000';

function checkBoxes() {
  return [
    document.querySelector('#block_new_accounts').checked,
    document.querySelector('#block_low_followers').checked,
    document.querySelector('#share_blocks').checked,
    document.querySelector('#follow_blocktogether').checked
  ];
}

casper.test.begin('Block low follower users', 2, function(test) {
  casper.start(host, function() {
    this.click('#block_low_followers');
    return this.fill('form[action*="/auth/twitter"]', {}, true);
  });

  casper.waitForSelector('#oauth_form', function() {
    return this.fill(
      'form[id="oauth_form"]',
      // NB: must use single quotes
      { 'session[username_or_email]': mainUser, 'session[password]': mainPass }, true);
  });

  casper.waitForSelector('.container-fluid', function() {
    var checks = this.evaluate(checkBoxes);
    test.assertEqual(checks, [false, true, false, true], 'blocking low follower users');
  });

  casper.waitForSelector('.saved', function() {
    casper.open('https://twitter.com/logout', function() {
      return true;
    });
  });

  casper.waitForSelector('.signout', function() {
    return this.fill('form[action*="/logout"]', {}, true);
  });

  casper.thenOpen('https://twitter.com/login', function() {
    return true;
  });

  casper.waitForSelector('.signin', function() {
    return this.fill(
      'form[action*="https://twitter.com/sessions"]',
      { 'session[username_or_email]': lowUser, 'session[password]': lowPass }, true);
  });

  // Random number so we don't get blocked for duplicate tweets
  casper.thenOpen('https://twitter.com/intent/tweet?text=@' +
                  mainUser + ' ive got ' + Math.random() + ' problems',
                  function() {
                    return true;
                  });

  casper.waitForSelector('#update-form', function() {
    return this.fill('form[id="update-form"]', {}, true);
  });

  casper.wait(15000, function() {
    casper.open('https://twitter.com/' + mainUser, function() {
      return true;
    });
  });

  casper.waitForSelector('.dropdown', function() {
    test.assert(this.exists('.BlocksYouTimeline'), 'Low follower user is blocked');
  });

  casper.thenOpen(host + '/logout', function() {
    return true;
  });

  casper.thenOpen('https://twitter.com/logout', function() {
    return this.fill('form[action*="/logout"]', {}, true);
  });

  casper.run(function() {
    test.done();
  });
});
