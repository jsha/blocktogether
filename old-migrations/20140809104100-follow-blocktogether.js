module.exports = {
  up: function(migration, DataTypes, done) {
    migration.addColumn(
      'BtUsers',
      'follow_blocktogether',
      DataTypes.BOOLEAN
    );
    done();
  },
  down: function(migration, DataTypes, done) {
    migration.removeColumn('BtUsers', 'follow_blocktogether');
    done()
  }
}
