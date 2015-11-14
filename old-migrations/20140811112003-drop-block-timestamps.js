module.exports = {
  up: function(migration, DataTypes, done) {
    migration.removeColumn('Blocks', 'updatedAt');
    migration.removeColumn('Blocks', 'createdAt');
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.addColumn('Blocks', 'updatedAt', DataTypes.DATE);
    migration.addColumn('Blocks', 'createdAt', DataTypes.DATE);
    done()
  }
}
