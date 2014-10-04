module.exports = {
  up: function(migration, DataTypes, done) {
    // The index we need for the periodic-update query on the TwitterUsers table
    // is on both updatedAt and deactivatedAt. Otherwise, all the oldest
    // TwitterUsers (with the earliest updatedAt dates) clog up the query, so
    // MySQL has to slog through a large number of deactivated users before
    // finding the good ones.
    migration.removeIndex('TwitterUsers', ['createdAt']);
    migration.removeIndex('TwitterUsers', ['updatedAt']);
    migration.addIndex('TwitterUsers', ['updatedAt', 'deactivatedAt']);
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.addIndex('TwitterUsers', ['createdAt']);
    migration.addIndex('TwitterUsers', ['updatedAt']);
    migration.removeIndex('TwitterUsers', ['updatedAt', 'deactivatedAt']);
    done()
  }
}
