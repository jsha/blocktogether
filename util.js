'use strict';
(function() {

var Q = require('q'),
    logger = require('./setup').logger;

/**
 * Run a function for each element in the list, with an interval between each
 * run.
 * Useful for spreading out processing batches so they don't happen too fast,
 * which is especially helpful for Twitter API calls because it allows more
 * connection reuse.
 * @param {Array} list List of items to process
 * @param {Number} interval Time in milliseconds to wait between each processing
 *   batch.
 * @param {Function} f Function to call on each item. Should return a Promise.
 * @return {Promise.<Array.<Object> >} A promise that resolves once all the
 *   component promises resolve, or resolves early if there is any failure.
 */
function slowForEach(list, interval, f) {
  var promises = list.map(function(item, i) {
    return Q.delay(i * interval).then(f.bind(null, item));
  });
  return Q.all(promises);
}

module.exports = {
  slowForEach: slowForEach
};

if (require.main === module) {
  // A micro sanity test.
  slowForEach([1, 2, 3], 1000, function(item) {
    console.log(item);
    if (item === 2) { throw new Error('hate even numbers'); }
  }).then(function() {
    console.log('Done!');
  });
}
})();
