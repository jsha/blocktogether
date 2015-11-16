// Change encoding of TwitterUsers table to UTF8mb4 to accomodate non-ASCII
// characters.
module.exports = {
  up: function(migration, DataTypes, done) {
    // In UTF8mb4, characters can use up to six bytes. Max unique index field
    // size is 1000 bytes, so the default varchar(255) exceeds that. Instead,
    // since max uid size is 20 bytes and uids are guaranteed ASCII, set that as
    // max.
    migration.changeColumn(
      'TwitterUsers',
      'uid',
       DataTypes.STRING(20));
    migration.queryInterface.sequelize.query(
      'ALTER TABLE TwitterUsers CONVERT TO ' +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;')
      .then(done);
  },
  down: function(migration, DataTypes, done) {
    migration.changeColumn(
      'TwitterUsers',
      'uid',
       DataTypes.STRING);
    migration.queryInterface.sequelize.query(
      'ALTER TABLE TwitterUsers CONVERT TO ' +
      'CHARACTER SET latin1;')
      .then(done);
    done()
  }
}
