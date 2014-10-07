/** @interface */
function Twitter() {};
Twitter.prototype.blocks = function() {};
Twitter.prototype.mutes = function() {};
Twitter.prototype.friendships = function() {};
Twitter.prototype.users = function() {};
/** A representation of errors returned by the twitter module.
 * @interface */
function TwitterError() {};
/** @type{number} */ TwitterError.prototype.statusCode;
/** @type{string} */ TwitterError.prototype.data;

/** @interface */
function PagedTwitterResults() {};
/** @type{string} */ PagedTwitterResults.prototype.next_cursor_str;

/** @interface @extends{PagedTwitterResults} */
function TwitterBlocksResults() {};
/** @type{Array.<string>} */ TwitterBlocksResults.prototype.ids;

/** Sequelize methods return CustomEventEmitter
 * @interface */
function CustomEventEmitter(fct) {};
/**
 * @param {Object} data
 */
CustomEventEmitter.prototype.success = function(data) {};
/**
 * @param {Object} error
 */
CustomEventEmitter.prototype.error = function(error) {};

/** @interface */
function DAOFactory() {};
/** type{string} */ DAOFactory.prototype.id;
/** type{Date} */ DAOFactory.prototype.createdAt;
/** type{Date} */ DAOFactory.prototype.updatedAt;
/**
 * @param{Array.<Object>} options
 * @return{CustomEventEmitter}
 */
DAOFactory.prototype.bulkCreate = function(options){};
/**
 * @param{Array.<Object>} options
 * @return{CustomEventEmitter}
 */
DAOFactory.prototype.findAll = function(options){};
/**
 * @param{Array.<Object>} options
 * @return{CustomEventEmitter}
 */
DAOFactory.prototype.findOrCreate = function(options){};
/**
 * @return{CustomEventEmitter}
 */
DAOFactory.prototype.reload = function(){};
/**
 * @return{CustomEventEmitter}
 */
DAOFactory.prototype.save = function(){};
/**
 * @return{boolean}
 */
DAOFactory.prototype.changed = function(){};

/** This doesn't correspond to an actual JS type, but instead represents the
 * JSON object representing a user from the Twitter API.
 * @interface */
function TwitterUserJSON() {};
/** @type{string} */ TwitterUserJSON.prototype.id_str;

/** @interface @extends {DAOFactory} */
function TwitterUser() {};
/** type{string} */ TwitterUser.prototype.uid;
/** type{number} */ TwitterUser.prototype.friends_count;
/** type{number} */ TwitterUser.prototype.followers_count;
/** type{string} */ TwitterUser.prototype.profile_image_url_https;
/** type{string} */ TwitterUser.prototype.screen_name;
/** type{string} */ TwitterUser.prototype.name;
/** type{Date} */ TwitterUser.prototype.deactivatedAt;
/** @interface @extends {DAOFactory} */
function BtUser() {};
/** type{string} */ BtUser.prototype.uid;
/** type{string} */ BtUser.prototype.screen_name;
/** type{string} */ BtUser.prototype.access_token;
/** type{string} */ BtUser.prototype.access_token_secret;
/** type{string} */ BtUser.prototype.shared_blocks_key;
/** type{boolean} */ BtUser.prototype.block_new_accounts;
/** type{boolean} */ BtUser.prototype.block_low_followers;
/** type{boolean} */ BtUser.prototype.follow_blocktogether;
/** type{Date} */ BtUser.prototype.deactivatedAt;
/** @interface @extends {DAOFactory} */
function Block() {};
/** type{string} */ Block.prototype.sink_uid;
/** type{string} */ Block.prototype.type;
/** @interface @extends {DAOFactory} */
function BlockBatch() {};
/** type{string} */ BlockBatch.prototype.source_uid;
/** type{string} */ BlockBatch.prototype.currentCursor;
/** type{boolean} */ BlockBatch.prototype.complete;
/** @interface @extends {DAOFactory} */
function Action() {};
/** type{string} */ Action.prototype.source_uid;
/** type{string} */ Action.prototype.sink_uid;
/** type{string} */ Action.prototype.type;
/** type{string} */ Action.prototype.status;
/** type{string} */ Action.prototype.cause;
/** type{string} */ Action.prototype.cause_uid;
/** type{string} */ Action.prototype.PENDING;
/** type{string} */ Action.prototype.DONE;
/** type{string} */ Action.prototype.CANCELLED_FOLLOWING;
/** type{string} */ Action.prototype.CANCELLED_SUSPENDED;
/** type{string} */ Action.prototype.CANCELLED_DUPLICATE;
/** type{string} */ Action.prototype.CANCELLED_UNBLOCKED;
/** type{string} */ Action.prototype.CANCELLED_SELF;
/** type{string} */ Action.prototype.DEFERRED_TARGET_SUSPENDED;
/** type{string} */ Action.prototype.DEFERRED_SOURCE_DEACTIVATED;
/** type{string} */ Action.prototype.BLOCK;
/** type{string} */ Action.prototype.UNBLOCK;
/** type{string} */ Action.prototype.BULK_MANUAL_BLOCK;
/** type{string} */ Action.prototype.NEW_ACCOUNT;
/** type{string} */ Action.prototype.LOW_FOLLOWERS;

/** An Express request object
 * @interface */
function ExpressRequest() {};
/** @type{BtUser} */
ExpressRequest.prototype.user;
/** An Express app object
 * @interface */
function ExpressApp() {};
/** @type{Function} */
ExpressApp.prototype.use;

/** @interface */
function SetupModule() {};
/** @type{Twitter} */ SetupModule.prototype.twitter;
/** @type{Object} */ SetupModule.prototype.logger;
/** @type{Object} */ SetupModule.prototype.sequelize;
/** @type{Object} */ SetupModule.prototype.config;
