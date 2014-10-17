module.exports = {
  up: function(migration, DataTypes, done) {
    migration.addIndex('BtUsers', ['shared_blocks_key']);
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.removeIndex('BtUsers', ['shared_blocks_key']);
    done()
  }
}
