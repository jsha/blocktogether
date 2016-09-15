module.exports = function(casper, host) {
  casper.thenOpen(host + '/logout', function() {
    return true;
  });

  casper.thenOpen('https://twitter.com/logout', function() {
    return this.fill('form[action*="/logout"]', {}, true);
  });
};
