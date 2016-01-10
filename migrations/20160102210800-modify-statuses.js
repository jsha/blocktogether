'use strict';

module.exports = {
  up: function (queryInterface, Sequelize) {
    var create =
      'CREATE TABLE `Action2s` (' +
      '`id` int(11) NOT NULL AUTO_INCREMENT,' +
      '`source_uid` BIGINT UNSIGNED NOT NULL,' +
      '`sink_uid` BIGINT UNSIGNED NOT NULL,' +
      '`type` TINYINT(1) NOT NULL,' +
      '`status` TINYINT(1) NOT NULL,' +
      '`createdAt` datetime NOT NULL,' +
      '`updatedAt` datetime NOT NULL,' +
      '`cause` TINYINT(1) NOT NULL,' +
      '`cause_uid` BIGINT UNSIGNED NOT NULL,' +
      'PRIMARY KEY (`id`),' +
      'KEY `actions_source_uid_sink_uid` (`source_uid`,`sink_uid`),' +
      'KEY `actions_source_uid_status_created_at` (`source_uid`,`status`,`createdAt`)' +
      ') ENGINE=InnoDB AUTO_INCREMENT=1000 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';

    var insert =
      'INSERT INTO Action2s SELECT ' +
      'id, source_uid, sink_uid, ' +
      'FIELD(type, "block", "unblock", "mute"), ' +
      'FIELD(status, "pending", "done", "cancelled-following", "cancelled-suspended", "cancelled-duplicate", "cancelled-unblocked", "cancelled-self", "deferred-target-suspended", "cancelled-source-deactivated", "cancelled-unsubscribed"), ' +
      'createdAt, updatedAt, ' +
      'FIELD(cause, "external", "subscription", "new-account", "low-followers", "bulk-manual-block"), ' +
      'cause_uid FROM Actions;';

      return queryInterface.sequelize.query(create).then(function() {
        return queryInterface.sequelize.query(insert);
      });
  },

  down: function (queryInterface, Sequelize) {
  }
};
