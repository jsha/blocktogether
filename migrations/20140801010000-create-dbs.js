module.exports = {
  up: function(migration, DataTypes, done) {
    migration.createTable(
      'TwitterUsers', {
      uid: {
        type: 'VARCHAR(20)',
        primaryKey: true
      },
      friends_count: DataTypes.INTEGER,
      followers_count: DataTypes.INTEGER,
      profile_image_url_https: DataTypes.STRING,
      screen_name: DataTypes.STRING,
      name: DataTypes.STRING,
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE
    }, {
      charset: 'utf8mb4'
    });
    migration.createTable(
      'BtUsers', {
      uid: {
        type: 'VARCHAR(20)',
        primaryKey: true
      },
      screen_name: DataTypes.STRING,
      access_token: DataTypes.STRING,
      access_token_secret: DataTypes.STRING,
      shared_blocks_key: DataTypes.STRING,
      block_new_accounts: DataTypes.BOOLEAN,
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE
    }, {
      charset: 'utf8mb4'
    });
    migration.createTable('BlockBatches', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      uid: {
        type: 'VARCHAR(20)',
        primaryKey: true
      },
      currentCursor: DataTypes.STRING,
      complete: DataTypes.BOOLEAN,
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE
    }, {
      charset: 'utf8mb4'
    });
    migration.createTable( 'Blocks', {
      source_uid: DataTypes.STRING
    }, {
      charset: 'utf8mb4'
    });
    migration.createTable('Actions', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      source_uid: 'VARCHAR(20)',
      sink_uid: 'VARCHAR(20)',
      type: DataTypes.STRING,
      status: DataTypes.STRING,
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE
    }, {
      charset: 'utf8mb4'
    });
    migration.createTable('UnblockedUsers', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      source_uid: 'VARCHAR(20)',
      sink_uid: 'VARCHAR(20)',
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE
    }, {
      charset: 'utf8mb4'
    });
    done();
  },
  down: function(migration, DataTypes, done) {
    done();
  }
}
