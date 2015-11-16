module.exports = {
  up: function(migration, DataTypes, done) {
    migration.addIndex('TwitterUsers', ['uid']);
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.removeIndex('TwitterUsers', ['uid']);
    done()
  }
}
