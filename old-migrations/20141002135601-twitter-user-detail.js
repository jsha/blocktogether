module.exports = {
  up: function(migration, DataTypes, done) {
    migration.addColumn('TwitterUsers',
      'lang', DataTypes.STRING);
    migration.addColumn('TwitterUsers',
      'statuses_count', DataTypes.INTEGER);
    migration.addColumn('TwitterUsers',
      'account_created_at', DataTypes.DATE);
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.removeColumn('TwitterUsers',
      'lang');
    migration.removeColumn('TwitterUsers',
      'statuses_count');
    migration.removeColumn('TwitterUsers',
      'account_created_at');
    done()
  }
}
