module.exports = {
  up: function(migration, DataTypes, done) {
    // The previous version of this index had the indexed fields in the wrong
    // order, so it didn't do much good. After sorting by updatedAt, we would
    // then have the deactivatedAt sorted nicely. But we want the other way
    // around: ignore everything with non-null deactivatedAt, *then* look at
    // updatedAt.
    migration.addIndex('TwitterUsers', ['deactivatedAt', 'updatedAt']);
    migration.removeIndex('TwitterUsers', ['updatedAt', 'deactivatedAt']);
    done()
  },
  down: function(migration, DataTypes, done) {
    migration.removeIndex('TwitterUsers', ['deactivatedAt', 'updatedAt']);
    migration.addIndex('TwitterUsers', ['updatedAt', 'deactivatedAt']);
    done()
  }
}
