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
 * @param {Function} f Function to call on each item.
 */
function slowForEach(list, interval, f) {
  var deferred = Q.defer();
  var items = list.slice();
  // Start a stream for each user, spaced 100 ms apart. Once all users have had
  // their stream started, start the periodic process of checking for any
  // streams that have failed and restarting them.
  function run() {
    if (items.length) {
      var current = items.shift();
      f(current);
      setTimeout(run, interval);
    } else {
      deferred.resolve();
    }
  }
  run();
  return deferred.promise;
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
  }).then(function() {
    console.log('Done!');
  });
}
})();
