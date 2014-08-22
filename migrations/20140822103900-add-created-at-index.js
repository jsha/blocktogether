module.exports = {
  up: function(migration, DataTypes, done) {
    migration.addIndex('TwitterUsers', ['createdAt']);
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.removeIndex('TwitterUsers', ['createdAtAt']);
    done()
  }
}
