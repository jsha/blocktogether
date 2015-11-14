module.exports = {
  up: function(migration, DataTypes, done) {
    // Optimizes the query in update-blocks.js' recordAction() that checks for
    // previous Actions executed for a given (source_uid, sink_uid) pair.
    migration.addIndex('Actions', ['source_uid', 'sink_uid']);
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.removeIndex('Actions', ['source_uid', 'sink_uid']);
    done()
  }
}
