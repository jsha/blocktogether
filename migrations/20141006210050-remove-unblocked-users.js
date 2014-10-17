module.exports = {
  up: function(migration, DataTypes, done) {
    // Move contents of UnblockedUsers table into Actions.
    migration.queryInterface.sequelize.query(
      'INSERT INTO `Actions` ' +
      '(`source_uid`, `sink_uid`, `type`, `status`, `cause`, `cause_uid`, `updatedAt`, `createdAt`) ' +
      'SELECT `source_uid`, `sink_uid`, "unblock", "done", "external", null, `updatedAt`, `createdAt` ' +
      'FROM UnblockedUsers');
    done()
  },
  down: function(migration, DataTypes, done) {
    done()
  }
}
