module.exports = {
  up: function(migration, DataTypes, done) {
    // XXX TODO: Need to modify encoding of author_uid / subscriber_uid.
    // Subscriptions get deleted when their author or subscriber gets deleted.
    return migration.addIndex('Subscriptions', ['author_uid']
    ).then(function() {
      return migration.addIndex('Subscriptions', ['subscriber_uid']);
    }).then(function() {
      return migration.queryInterface.sequelize.query(
        'ALTER TABLE Subscriptions ' +
        'CONVERT TO CHARACTER SET utf8mb4 ' +
        'COLLATE utf8mb4_unicode_ci;');
    }).then(function() {
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
    }).then(done);
  },
  down: function(migration, DataTypes, done) {
    done()
  }
}
