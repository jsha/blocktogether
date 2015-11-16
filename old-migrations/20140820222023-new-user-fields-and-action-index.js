module.exports = {
  up: function(migration, DataTypes, done) {
    migration.addIndex('Actions', ['status']);
    migration.addColumn(
      'Actions',
      'cause',
      DataTypes.STRING
    );
    migration.addColumn(
      'Actions',
      'cause_uid',
      DataTypes.STRING
    );
    migration.addColumn(
      'BtUsers',
      'deactivatedAt',
      DataTypes.DATE
    );
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.removeColumn('BtUsers', 'deactivatedAt');
    migration.removeColumn('Actions', 'cause');
    migration.removeColumn('Actions', 'cause_uid');
    done()
  }
}
