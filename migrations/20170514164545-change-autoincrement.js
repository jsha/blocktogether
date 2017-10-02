'use strict';

var fs = require('fs');

module.exports = {
  up: function (queryInterface, Sequelize) {
    return queryInterface.sequelize.query('alter table Actions MODIFY COLUMN `id` bigint unsigned NOT NULL AUTO_INCREMENT;');
  },

  down: function (queryInterface, Sequelize) {
  }
};
