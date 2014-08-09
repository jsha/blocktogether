module.exports = {
  up: function(migration, DataTypes, done) {
    migration.addColumn(
      'BtUsers',
      'follow_blocktogether',
      DataTypes.BOOLEAN
    );
  }
}
