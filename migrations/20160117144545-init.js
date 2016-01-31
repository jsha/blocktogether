'use strict';

var fs = require('fs');

module.exports = {
  up: function (queryInterface, Sequelize) {
    var sql = fs.readFileSync('migrations/init2.sql');
    var queries = sql.toString().split(';');
    function doQueries(list) {
      if (list.length === 0 || list[0] === '\n') {
        return;
      }
      var oneQuery = list[0];
      console.log('query:', oneQuery);
      return queryInterface.sequelize.query(oneQuery).then(function() {
        return doQueries(list.slice(1));
      })
    }
    return doQueries(queries);
  },

  down: function (queryInterface, Sequelize) {
  }
};
