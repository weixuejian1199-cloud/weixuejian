CREATE TABLE `bot_messages` (
	`id` varchar(64) NOT NULL,
	`botId` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`role` enum('user','bot') NOT NULL,
	`content` text NOT NULL,
	`externalId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bot_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bots` (
	`id` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text,
	`avatar` varchar(255) DEFAULT '🤖',
	`token` varchar(128) NOT NULL,
	`webhookUrl` text,
	`enabled` int NOT NULL DEFAULT 1,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bots_id` PRIMARY KEY(`id`),
	CONSTRAINT `bots_token_unique` UNIQUE(`token`)
);
