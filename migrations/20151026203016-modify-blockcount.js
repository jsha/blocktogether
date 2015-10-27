'use strict';

module.exports = {
  up: function (queryInterface, Sequelize) {
    return queryInterface.removeColumn('BtUsers',
      'blockCount').then(function() {
      return queryInterface.addColumn('BtUsers',
        'blockCount', Sequelize.INTEGER);
      });
  },

  down: function (queryInterface, Sequelize) {
    return queryInterface.removeColumn('BtUsers',
      'blockCount');
  }
};
