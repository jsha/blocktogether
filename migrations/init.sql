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

--
-- Table structure for table `Actions`
--

DROP TABLE IF EXISTS `Actions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `Actions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `source_uid` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sink_uid` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `type` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `cause` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cause_uid` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `actions_source_uid_sink_uid` (`source_uid`,`sink_uid`),
  KEY `actions_source_uid_status_created_at` (`source_uid`,`status`(191),`createdAt`),
  CONSTRAINT `Actions_ibfk_1` FOREIGN KEY (`source_uid`) REFERENCES `BtUsers` (`uid`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1000 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `BlockBatches`
--

DROP TABLE IF EXISTS `BlockBatches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `BlockBatches` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `source_uid` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `currentCursor` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `complete` tinyint(1) DEFAULT NULL,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `size` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`,`source_uid`),
  KEY `block_batches_source_uid` (`source_uid`),
  CONSTRAINT `BlockBatches_ibfk_1` FOREIGN KEY (`source_uid`) REFERENCES `BtUsers` (`uid`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Blocks`
--

DROP TABLE IF EXISTS `Blocks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `Blocks` (
  `sink_uid` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `type` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BlockBatchId` int(11) DEFAULT NULL,
  KEY `blocks_block_batch_id` (`BlockBatchId`),
  CONSTRAINT `Blocks_ibfk_1` FOREIGN KEY (`BlockBatchId`) REFERENCES `BlockBatches` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `BtUsers`
--

DROP TABLE IF EXISTS `BtUsers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `BtUsers` (
  `uid` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `screen_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `access_token` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `access_token_secret` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `shared_blocks_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `block_new_accounts` tinyint(1) DEFAULT NULL,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `follow_blocktogether` tinyint(1) DEFAULT NULL,
  `deactivatedAt` datetime DEFAULT NULL,
  `block_low_followers` tinyint(1) DEFAULT NULL,
  `pendingActions` tinyint(1) DEFAULT NULL,
  `paused` tinyint(1) DEFAULT NULL,
  `blockCount` int(11) DEFAULT NULL,
  PRIMARY KEY (`uid`),
  KEY `bt_users_deactivated_at_updated_at` (`deactivatedAt`,`updatedAt`),
  KEY `bt_users_shared_blocks_key` (`shared_blocks_key`(191)),
  KEY `bt_users_pending_actions` (`pendingActions`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `SharedBlocks`
--

DROP TABLE IF EXISTS `SharedBlocks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `SharedBlocks` (
  `author_uid` varchar(20) NOT NULL,
  `sink_uid` varchar(20) NOT NULL,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  KEY `shared_blocks_author_uid` (`author_uid`),
  KEY `shared_blocks_sink_uid` (`sink_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Subscriptions`
--

DROP TABLE IF EXISTS `Subscriptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `Subscriptions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `author_uid` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `subscriber_uid` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `subscriptions_author_uid_subscriber_uid` (`author_uid`,`subscriber_uid`),
  KEY `subscriptions_author_uid` (`author_uid`),
  KEY `subscriptions_subscriber_uid` (`subscriber_uid`),
  CONSTRAINT `Subscriptions_ibfk_1` FOREIGN KEY (`author_uid`) REFERENCES `BtUsers` (`uid`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Subscriptions_ibfk_2` FOREIGN KEY (`subscriber_uid`) REFERENCES `BtUsers` (`uid`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=100 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `TwitterUsers`
--

DROP TABLE IF EXISTS `TwitterUsers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `TwitterUsers` (
  `uid` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `friends_count` int(11) DEFAULT NULL,
  `followers_count` int(11) DEFAULT NULL,
  `profile_image_url_https` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `screen_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  `deactivatedAt` datetime DEFAULT NULL,
  `lang` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `statuses_count` int(11) DEFAULT NULL,
  `account_created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`uid`),
  KEY `twitter_users_screen_name` (`screen_name`(191)),
  KEY `twitter_users_deactivated_at_updated_at` (`deactivatedAt`,`updatedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `UnblockedUsers`
--

DROP TABLE IF EXISTS `UnblockedUsers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `UnblockedUsers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `source_uid` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sink_uid` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT NULL,
  `updatedAt` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=30661 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2015-11-14 22:45:03
