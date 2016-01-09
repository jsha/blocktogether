'use strict';

module.exports = {
  up: function (queryInterface, Sequelize) {
      return queryInterface.addColumn('Actions',
        'statusNum', 'TINYINT'
      ).then(function() {
        return queryInterface.addColumn('Actions',
          'causeNum', 'TINYINT');
      }).then(function() {
        return queryInterface.addColumn('Actions',
          'typeNum', 'TINYINT');
      }).then(function() {
        var query = 'UPDATE Actions SET ' +
          'statusNum = FIELD(status, "pending", "done", "cancelled-following", "cancelled-suspended", "cancelled-duplicate", "cancelled-unblocked", "cancelled-self", "deferred-target-suspended", "cancelled-source-deactivated", "cancelled-unsubscribed"), ' + 
          'causeNum = FIELD(cause, "external", "subscription", "new-account", "low-followers", "bulk-manual-block"), ' +
          'typeNum = FIELD(type, "block", "unblock", "mute");'
        return queryInterface.sequelize.query(query);
      });
  },

  down: function (queryInterface, Sequelize) {
  }
};
