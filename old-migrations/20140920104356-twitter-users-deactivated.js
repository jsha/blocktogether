module.exports = {
  up: function(migration, DataTypes, done) {
    migration.addColumn(
      'TwitterUsers',
      'deactivatedAt',
      DataTypes.DATE
    );
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.removeColumn(
      'TwitterUsers',
      'deactivatedAt');
    done()
  }
}
