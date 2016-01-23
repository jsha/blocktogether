/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

CREATE TABLE `Actions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `source_uid` BIGINT UNSIGNED NOT NULL,
  `sink_uid` BIGINT UNSIGNED NOT NULL,
  `typeNum` TINYINT(1) DEFAULT NULL,
  `statusNum` TINYINT(1) DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `causeNum` TINYINT(1) DEFAULT NULL,
  `cause_uid` BIGINT UNSIGNED,
  `type` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cause` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `actions_source_uid_sink_uid` (`source_uid`,`sink_uid`),
  KEY `actions_source_uid_status_created_at` (`source_uid`,`statusNum`,`createdAt`)
) ENGINE=InnoDB AUTO_INCREMENT=1000 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TRIGGER numifyInsert BEFORE INSERT ON Actions FOR EACH ROW SET
  NEW.typeNum = FIELD(NEW.type, "block", "unblock", "mute"),
  NEW.type = NULL,
  NEW.statusNum = FIELD(NEW.status, "pending", "done", "cancelled-following", "cancelled-suspended", "cancelled-duplicate", "cancelled-unblocked", "cancelled-self", "deferred-target-suspended", "cancelled-source-deactivated", "cancelled-unsubscribed"),
  NEW.status = NULL,
  NEW.causeNum = FIELD(NEW.cause, "external", "subscription", "new-account", "low-followers", "bulk-manual-block"),
  NEW.cause = NULL;

CREATE TRIGGER numifyUpdate BEFORE UPDATE ON Actions FOR EACH ROW SET
  NEW.statusNum = FIELD(NEW.status, "pending", "done", "cancelled-following", "cancelled-suspended", "cancelled-duplicate", "cancelled-unblocked", "cancelled-self", "deferred-target-suspended", "cancelled-source-deactivated", "cancelled-unsubscribed"),
  NEW.status = NULL;

CREATE TABLE `BlockBatches` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `source_uid` BIGINT UNSIGNED NOT NULL,
  `currentCursor` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `complete` tinyint(1) NOT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `size` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`,`source_uid`),
  KEY `block_batches_source_uid` (`source_uid`),
  CONSTRAINT `BlockBatches_ibfk_1` FOREIGN KEY (`source_uid`) REFERENCES `BtUsers` (`uid`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Blocks` (
  `sink_uid` BIGINT UNSIGNED NOT NULL,
  `BlockBatchId` int(11) DEFAULT NULL,
  KEY `blocks_block_batch_id` (`BlockBatchId`),
  CONSTRAINT `Blocks_ibfk_1` FOREIGN KEY (`BlockBatchId`) REFERENCES `BlockBatches` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `BtUsers` (
  `uid` BIGINT UNSIGNED NOT NULL,
  `screen_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `access_token` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `access_token_secret` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `shared_blocks_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `block_new_accounts` tinyint(1) NOT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `follow_blocktogether` tinyint(1) NOT NULL,
  `deactivatedAt` datetime DEFAULT NULL,
  `block_low_followers` tinyint(1) NOT NULL,
  `pendingActions` tinyint(1) NOT NULL,
  `paused` tinyint(1) NOT NULL,
  `blockCount` int(11) DEFAULT NULL,
  PRIMARY KEY (`uid`),
  KEY `bt_users_deactivated_at_updated_at` (`deactivatedAt`,`updatedAt`),
  KEY `bt_users_shared_blocks_key` (`shared_blocks_key`(191)),
  KEY `bt_users_pending_actions` (`pendingActions`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `Subscriptions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `author_uid` BIGINT UNSIGNED NOT NULL,
  `subscriber_uid` BIGINT UNSIGNED NOT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `subscriptions_author_uid_subscriber_uid` (`author_uid`,`subscriber_uid`),
  KEY `subscriptions_author_uid` (`author_uid`),
  KEY `subscriptions_subscriber_uid` (`subscriber_uid`),
  CONSTRAINT `Subscriptions_ibfk_1` FOREIGN KEY (`author_uid`) REFERENCES `BtUsers` (`uid`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Subscriptions_ibfk_2` FOREIGN KEY (`subscriber_uid`) REFERENCES `BtUsers` (`uid`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=100 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `TwitterUsers` (
  `uid` BIGINT UNSIGNED NOT NULL,
  `friends_count` int(11) DEFAULT NULL,
  `followers_count` int(11) DEFAULT NULL,
  `profile_image_url_https` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `screen_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `deactivatedAt` datetime DEFAULT NULL,
  `lang` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `statuses_count` int(11) DEFAULT NULL,
  `account_created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`uid`),
  KEY `twitter_users_screen_name` (`screen_name`(191)),
  KEY `twitter_users_deactivated_at_updated_at` (`deactivatedAt`,`updatedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
