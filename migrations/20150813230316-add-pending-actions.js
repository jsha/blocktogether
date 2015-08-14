'use strict';

module.exports = {
  up: function (queryInterface, Sequelize) {
    return queryInterface.addColumn('BtUsers',
      'pendingActions', Sequelize.BOOLEAN).then(function() {
      return queryInterface.addIndex('BtUsers', ['pendingActions']);
    });
  },

  down: function (queryInterface, Sequelize) {
    return queryInterface.removeColumn('BtUsers',
      'pendingActions');
  }
};
