module.exports = {
  up: function(migration, DataTypes, done) {
    migration.addIndex('BtUsers', ['updatedAt']);
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.removeIndex('BtUsers', ['updatedAt']);
    done()
  }
}
