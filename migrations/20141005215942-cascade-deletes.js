module.exports = {
  up: function(migration, DataTypes, done) {
    // Blocks get deleted when their BlockBatch gets deleted.
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
  },
  down: function(migration, DataTypes, done) {
    done()
  }
}
