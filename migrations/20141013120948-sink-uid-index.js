module.exports = {
  up: function(migration, DataTypes, done) {
    migration.addIndex('Actions', ['sink_uid']);
    migration.addIndex('Actions', ['source_uid', 'sink_uid', 'type']);
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.removeIndex('Actions', ['sink_uid']);
    migration.removeIndex('Actions', ['source_uid', 'sink_uid', 'type']);
    done()
  }
}
