CREATE TABLE `admin_api_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`keyHash` varchar(128) NOT NULL,
	`keyPrefix` varchar(20) NOT NULL,
	`isActive` int NOT NULL DEFAULT 1,
	`lastUsedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_api_keys_keyHash_unique` UNIQUE(`keyHash`)
);
