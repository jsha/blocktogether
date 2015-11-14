module.exports = {
  up: function(migration, DataTypes, done) {
    migration.addColumn(
      'BlockBatches',
      'size',
      DataTypes.INTEGER
    );
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.removeColumn(
      'BlockBatches',
      'size');
    done()
  }
}
