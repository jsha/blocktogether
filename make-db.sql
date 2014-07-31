-- Instructions:
--  Edit to replace XXX With '<a good password>'
--  $ mysql -u root -p < make-db.sql
CREATE DATABASE blocktogether;
GRANT ALL ON blocktogether.* to 'blocktogether'@'localhost' IDENTIFIED BY XXX;

CREATE TABLE IF NOT EXISTS `blocktogether`.`twitter_tokens` (
  `uid` varchar(255) NOT NULL DEFAULT '',
  `access_token` varchar(255) DEFAULT NULL,
  `access_token_secret` varchar(255) DEFAULT NULL,
PRIMARY KEY (`uid`));

CREATE TABLE IF NOT EXISTS `blocktogether`.`blocks` (
  `source_uid` varchar(255) NOT NULL,
  `sink_uid` varchar(255) NOT NULL,
  `observed_date` TIMESTAMP,
  `trigger` varchar(255),
INDEX source (`source_uid`),
INDEX sink (`sink_uid`));

CREATE TABLE IF NOT EXISTS `blocktogether`.`user` (
  `uid` varchar(255) NOT NULL,
  `updated` TIMESTAMP,
  `friends_count` INT,
  `followers_count` INT,
  `profile_image_url_https` varchar(255),
  `screen_name` varchar(255),
  `name` varchar(255),
  `json` varchar(4096),
PRIMARY KEY (`uid`));
