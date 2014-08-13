module.exports = {
  up: function(migration, DataTypes, done) {
    migration.addIndex('Actions', ['source_uid']);
    migration.addIndex('BlockBatches', ['source_uid']);
    migration.addIndex('Blocks', ['BlockBatchId']);
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.removeIndex('Actions', ['source_uid']);
    migration.removeIndex('BlockBatches', ['source_uid']);
    migration.removeIndex('Blocks', ['source_uid']);
    done()
  }
}
