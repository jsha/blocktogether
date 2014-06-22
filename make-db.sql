CREATE TABLE `twitter_tokens` (
  `uid` varchar(255) NOT NULL DEFAULT '',
  `accessToken` varchar(255) DEFAULT NULL,
  `accessTokenSecret` varchar(255) DEFAULT NULL,
PRIMARY KEY (`uid`));
