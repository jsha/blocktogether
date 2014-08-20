module.exports = {
  up: function(migration, DataTypes, done) {
    // Accidentally added a redundant index on uid (the primary key).
    // Remove that one and add to screen name as intended.
    migration.removeIndex('TwitterUsers', ['uid']);
    migration.addIndex('TwitterUsers', ['screen_name']);
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.addIndex('TwitterUsers', ['uid']);
    migration.removeIndex('TwitterUsers', ['screen_name']);
    done()
  }
}
