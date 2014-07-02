CREATE TABLE IF NOT EXISTS `twitter_tokens` (
  `uid` varchar(255) NOT NULL DEFAULT '',
  `accessToken` varchar(255) DEFAULT NULL,
  `accessTokenSecret` varchar(255) DEFAULT NULL,
PRIMARY KEY (`uid`));

CREATE TABLE IF NOT EXISTS `blocks` (
  `source_uid` varchar(255) NOT NULL,
  `sink_uid` varchar(255) NOT NULL,
  `observed_date` TIMESTAMP,
  `trigger` varchar(255),
INDEX source (`source_uid`),
INDEX sink (`sink_uid`));

CREATE TABLE IF NOT EXISTS `user` (
  `uid` varchar(255) NOT NULL,
  `updated` TIMESTAMP,
  `friends_count` INT,
  `followers_count` INT,
  `profile_image_url_https` varchar(255),
  `screen_name` varchar(255),
  `name` varchar(255),
  `json` varchar(4096),
PRIMARY KEY (`uid`));
