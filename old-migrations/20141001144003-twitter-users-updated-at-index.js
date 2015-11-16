module.exports = {
  up: function(migration, DataTypes, done) {
    // Add an index on updatedAt so we can quickly query for outdated
    // TwitterUsers.
    migration.addIndex('TwitterUsers', ['updatedAt']);
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.removeIndex('TwitterUsers', ['updatedAt']);
    done()
  }
}
