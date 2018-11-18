'use strict';
/** @type{SetupModule} */
var setup = require('./setup'),
    Q = require('q');

var logger = setup.logger,
    BtUser = setup.BtUser,
    BlockBatch = setup.BlockBatch,
    Action = setup.Action,
    sequelize = setup.sequelize;

/**
 * Find users who deactivated more than thirty days ago and delete them from the
 * DB. In theory we could just delete the user and the foreign key constraints
 * would take care of deleting the rest.  We do it this way (deleting the
 * associated tables first), because users who have really large numbers of
 * Actions or Blocks cause the BtUsers table to be locked for a super long time
 * while deleting those. We do rely on foreign key constraints to delete the
 * blocks associated with the BlockBatches.
 */
function findAndDeleteOneOldUser() {
  return BtUser
    .findOne({
      where: {
        deactivatedAt: {
          lt: new Date(Date.now() - 30 * 86400 * 1000)
        }
      },
      order: [['deactivatedAt', 'ASC']]
    }).then(function(user) {
      if (user) {
        return deleteOneOldUser(user);
      } else {
        return Q.resolve(null);
      }
    }).catch(function(err) {
      logger.error(err);
    });
}

function deleteOneOldUser(user) {
  logger.info(user, user.dataValues);
  return Action.destroy({
    where: {
      source_uid: user.uid
    }
  }).then(function() {
    return BlockBatch.destroy({
      where: {
        source_uid: user.uid
      }
    });
  }).then(function() {
    return user.destroy();
  }).catch(function(err) {
    logger.error(err);
  });
}

async function processEternally() {
  while (true) {
    await findAndDeleteOneOldUser();
    await Q.delay(1000);
  }
}

async function cleanDuplicateActions() {
  const limit = 100000;
  for (;;) {
    var maxResult = await sequelize.query('SELECT max(id) FROM Actions;');
    var max = parseInt(maxResult[0][0]['max(id)']);
    for (let offset = 0; offset < max; offset += limit) {
      await sequelize.query('DELETE FROM Actions WHERE statusNum IN (3, 4, 5, 6, 7, 8, 9, 10) AND id > ? AND id < ? AND updatedAt < DATE_SUB(NOW(), INTERVAL 10 DAY);',
       {
         replacements: [offset, offset+limit],
         type: sequelize.QueryTypes.DELETE
       });
      await Q.delay(1000);
    }
  }
}

if (require.main === module) {
  setup.statsServer(6443);
  processEternally();
  cleanDuplicateActions().catch(function(err) {
    logger.error(err);
  });
}
