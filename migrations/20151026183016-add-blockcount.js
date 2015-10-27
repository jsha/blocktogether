'use strict';

module.exports = {
  up: function (queryInterface, Sequelize) {
    return queryInterface.addColumn('BtUsers',
      'blockCount', Sequelize.BOOLEAN);
  },

  down: function (queryInterface, Sequelize) {
    return queryInterface.removeColumn('BtUsers',
      'blockCount');
  }
};
