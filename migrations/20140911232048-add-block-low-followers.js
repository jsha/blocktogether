module.exports = {
  up: function(migration, DataTypes, done) {
    migration.addColumn(
      'BtUsers',
      'block_low_followers',
      DataTypes.BOOLEAN
    );
    done();
  },
  down: function(migration, DataTypes, done) {
    migration.removeColumn('BtUsers', 'block_low_followers');
    done()
  }
}
