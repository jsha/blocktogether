'use strict';

module.exports = {
  up: function (queryInterface, Sequelize) {
    return queryInterface.removeColumn('Blocks', 'id');
  },

  down: function (queryInterface, Sequelize) {
  }
};
