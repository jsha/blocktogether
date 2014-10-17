module.exports = {
  up: function(migration, DataTypes, done) {
    migration.queryInterface.sequelize.query(
        'ALTER TABLE Blocks DROP FOREIGN KEY Blocks_ibfk_1;'
    ).then(function() {
      return migration.queryInterface.sequelize.query(
        'ALTER TABLE BlockBatches DROP FOREIGN KEY BlockBatches_ibfk_1;');
    }).then(function() {
      return migration.queryInterface.sequelize.query(
        'ALTER TABLE Actions DROP FOREIGN KEY Actions_ibfk_1;');
    }).then(function() {
      return migration.changeColumn(
        'BtUsers',
        'uid',
        'VARCHAR(20) CHARACTER SET utf8mb4;');
    }).then(function() {
      return migration.changeColumn(
        'TwitterUsers',
        'uid',
        'VARCHAR(20) CHARACTER SET utf8mb4;');
    }).then(function() {
      return migration.changeColumn(
        'BlockBatches',
        'source_uid',
        'VARCHAR(20) CHARACTER SET utf8mb4;');
    }).then(function() {
      return migration.changeColumn(
        'Blocks',
        'sink_uid',
        'VARCHAR(20) CHARACTER SET utf8mb4;');
    }).then(function() {
      return migration.changeColumn(
        'Actions',
        'sink_uid',
        'VARCHAR(20) CHARACTER SET utf8mb4;');
    }).then(function() {
      return migration.changeColumn(
        'Actions',
        'source_uid',
        'VARCHAR(20) CHARACTER SET utf8;');
    }).then(function() {
      return migration.createTable('Subscriptions', {
        author_uid: 'VARCHAR(20) NOT NULL',
        subscriber_uid: 'VARCHAR(20) NOT NULL',
        createdAt: DataTypes.DATE,
        updatedAt: DataTypes.DATE
      }, {
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci'
      })
    }).then(function() {
      migration.addIndex('Subscriptions', ['author_uid']);
      migration.addIndex('Subscriptions', ['subscriber_uid']);
      migration.queryInterface.sequelize.query(
        'ALTER TABLE Subscriptions ADD ' +
        'CONSTRAINT `Subscriptions_ibfk_1` FOREIGN KEY (`author_uid`) ' +
        'REFERENCES `BtUsers` (`uid`) ' +
        'ON DELETE CASCADE ON UPDATE CASCADE;');
      migration.queryInterface.sequelize.query(
        'ALTER TABLE Subscriptions ADD ' +
        'CONSTRAINT `Subscriptions_ibfk_2` FOREIGN KEY (`subscriber_uid`) ' +
        'REFERENCES `BtUsers` (`uid`) ' +
        'ON DELETE CASCADE ON UPDATE CASCADE;');
      migration.queryInterface.sequelize.query(
        'ALTER TABLE Blocks ADD ' +
        'CONSTRAINT `Blocks_ibfk_1` FOREIGN KEY (`BlockBatchId`) ' +
        'REFERENCES `BlockBatches` (`id`) ' +
        'ON DELETE CASCADE ON UPDATE CASCADE;');
      // BlockBatches get deleted when their BtUser gets deleted.
      migration.queryInterface.sequelize.query(
        'ALTER TABLE BlockBatches ADD ' +
        'CONSTRAINT `BlockBatches_ibfk_1` FOREIGN KEY (`source_uid`) ' +
        'REFERENCES `BtUsers` (`uid`) ' +
        'ON DELETE CASCADE ON UPDATE CASCADE;');
      // Actions get deleted when their source BtUser gets deleted.
      migration.queryInterface.sequelize.query(
        'ALTER TABLE Actions ADD ' +
        'CONSTRAINT `Actions_ibfk_1` FOREIGN KEY (`source_uid`) ' +
        'REFERENCES `BtUsers` (`uid`) ' +
        'ON DELETE CASCADE ON UPDATE CASCADE;');
      done()
    });
  },
  down: function(migration, DataTypes, done) {
    migration.dropTable('Subscriptions');
    done()
  }
}
