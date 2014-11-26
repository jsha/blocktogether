module.exports = {
  up: function(migration, DataTypes, done) {
    return migration.dropTable('SharedBlocks')
    .then(function() {
      return migration.createTable('AnnotatedBlocks', {
        source_uid: 'VARCHAR(20) NOT NULL',
        sink_uid: 'VARCHAR(20) NOT NULL',
        shared: DataTypes.BOOLEAN,
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE,
        ActionId: DataTypes.INTEGER
      }, {
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci'
      })
    }).then(function() {
      return migration.addIndex('AnnotatedBlocks', ['source_uid', 'sink_uid'], {
        indicesType: 'UNIQUE'
      });
    }).then(function() {
      return migration.queryInterface.sequelize.query(
        'ALTER TABLE AnnotatedBlocks ADD ' +
        'CONSTRAINT `AnnotatedBlocks_ibfk_1` FOREIGN KEY (`source_uid`) ' +
        'REFERENCES `BtUsers` (`uid`) ' +
        'ON DELETE CASCADE ON UPDATE CASCADE;');
    }).then(done);
  },
  down: function(migration, DataTypes, done) {
    return migration.dropTable('AnnotatedBlocks').then(done);
  }
}
