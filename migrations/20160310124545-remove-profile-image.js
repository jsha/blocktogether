'use strict';

var fs = require('fs');

module.exports = {
  up: function (queryInterface, Sequelize) {
    return queryInterface.removeColumn('TwitterUsers', 'profile_image_url_https');
  },

  down: function (queryInterface, Sequelize) {
  }
};
