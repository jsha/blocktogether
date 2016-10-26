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

/**
 * Apply f to each item in list, returning a Promise containing the results.
 * f must return a Promise, and each application of f will wait on the
 * resolution of the previously-returned Promise.
 *
 * This is different than slowForEach in that it doesn't need to create
 * all the promises in advance, so it can be more memory-efficient when
 * handling large arrays. It also doesn't have a predefined interval,
 * but simply executes tasks sequentially.
 *
 * @param {Array} list List of items to process
 * @param {Function} f Function to call on each item. Should return a Promise.
 * @param {Array} accum Used internally. Callers should leave undefined.
 * @return {Promise.<Array.<Object> >} A promise that resolves once all the
 *   component promises resolve, or resolves early if there is any failure.
 */
function promiseMap(list, f, accum) {
  accum = accum || []
  if (list.length === 0) {
    return Q.resolve(accum);
  }
  return f(list[0]
  ).then(function(res) {
    return promiseMap(list.slice(1), f, accum.concat([res]));
  });
}

module.exports = {
  slowForEach: slowForEach,
  promiseMap: promiseMap
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
