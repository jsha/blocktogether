'use strict';

module.exports = {
  up: function (queryInterface, Sequelize) {
    return queryInterface.removeIndex('Actions', ['status', 'source_uid']);
  },

  down: function (queryInterface, Sequelize) {
    return queryInterface.createIndex('Actions', ['status', 'source_uid']);
  }
};
