CREATE TABLE `message_feedback` (
	`id` varchar(64) NOT NULL,
	`userId` int,
	`messagePreview` varchar(500),
	`rating` int NOT NULL,
	`comment` text,
	`context` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `message_feedback_id` PRIMARY KEY(`id`)
);
