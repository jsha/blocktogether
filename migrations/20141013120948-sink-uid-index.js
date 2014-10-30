module.exports = {
  up: function(migration, DataTypes, done) {
    // Optimizes this query from actions.js:
    // SELECT * FROM `Actions` WHERE status = "pending" GROUP BY source_uid
    // LIMIT 300;
    migration.addIndex('Actions', ['status', 'source_uid']);
    // Optimizes this query from actions.js:
    // SELECT * FROM `Actions` WHERE `source_uid` = 'NNNNNNNN' AND `status` =
    // 'pending' AND `type` = 'block' ORDER BY createdAt ASC LIMIT 100;
    migration.addIndex('Actions', ['source_uid', 'status', 'type', 'createdAt']);
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.removeIndex('Actions', ['status', 'source_uid']);
    migration.removeIndex('Actions', ['source_uid', 'status', 'type', 'createdAt']);
    done()
  }
}
