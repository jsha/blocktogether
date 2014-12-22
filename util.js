'use strict';
(function() {

var Q = require('q'),
    logger = require('./setup').logger;

/**
 * Run a function for each element in the list, with an interval between each
 * run. Doesn't attempt to wait on any promises the function may return.
 * Useful for spreading out processing batches so they don't happen too fast,
 * which is especially helpful for Twitter API calls because it allows more
 * connection reuse.
 * @param {Array} list List of items to process
 * @param {Number} interval Time in milliseconds to wait between each processing
 *   batch.
 * @param {Function} f Function to call on each item. Should return a Promise.
 * @return {Promise.<Array.<Object> >} A promise that resolves once all the
 *   component promises are settled.
 */
function slowForEach(list, interval, f) {
  var promises = list.map(function(item, i) {
    return Q.delay(i * interval).then(f.bind(null, item));
  });
  return Q.allSettled(promises);
}

function runWithoutOverlap(registry, item, f) {
  if (registry[item]) {
    logger.info('Skipping call of', f.name + '(' + item + '), already running.');
  } else {
    var promise = f(item);
    registry[item] = promise;
    promise.finally(function() {
      delete registry[item];
    });
  }
}

module.exports = {
  slowForEach: slowForEach,
  runWithoutOverlap: runWithoutOverlap
};

if (require.main === module) {
  slowForEach([1, 2, 3], 1000, function(item) {
    console.log(item);
    if (item === 2) { throw new Error('hate even numbers'); }
  }).then(function() {
    console.log('Done!');
  });
}
})();
