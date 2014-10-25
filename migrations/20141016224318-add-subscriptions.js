module.exports = {
  up: function(migration, DataTypes, done) {
    return migration.createTable('Subscriptions', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      author_uid: 'VARCHAR(20) NOT NULL',
      subscriber_uid: 'VARCHAR(20) NOT NULL',
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE
    }).then(function() {
      return migration.createTable('SharedBlocks', {
        author_uid: 'VARCHAR(20) NOT NULL',
        sink_uid: 'VARCHAR(20) NOT NULL',
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE
      });
    }).then(function() {
      migration.addIndex('Subscriptions', ['author_uid']);
      migration.addIndex('Subscriptions', ['subscriber_uid']);
      migration.addIndex('SharedBlocks', ['author_uid']);
      migration.addIndex('SharedBlocks', ['sink_uid']);
    }).then(done);
  },
  down: function(migration, DataTypes, done) {
    migration.dropTable('Subscriptions');
    migration.dropTable('SharedBlocks');
    done()
  }
}
