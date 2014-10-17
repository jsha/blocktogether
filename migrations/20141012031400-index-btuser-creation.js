module.exports = {
  up: function(migration, DataTypes, done) {
    migration.addIndex('BtUsers', ['deactivatedAt', 'updatedAt']);
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.removeIndex('BtUsers', ['deactivatedAt', 'updatedAt']);
    done()
  }
}
