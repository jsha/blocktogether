module.exports = {
  up: function(migration, DataTypes, done) {
    migration.addIndex('Action', ['source_uid']);
    migration.addIndex('BlockBatches', ['source_uid']);
    migration.addIndex('Blocks', ['BlockBatchId']);
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.removeIndex('Action', ['source_uid']);
    migration.removeIndex('BlockBatches', ['source_uid']);
    migration.removeIndex('Blocks', ['BlockBatchId']);
    done()
  }
}
