CREATE TABLE `report_feedback` (
	`id` varchar(64) NOT NULL,
	`reportId` varchar(64) NOT NULL,
	`sessionId` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`rating` int NOT NULL,
	`comment` text,
	`columnSignature` text,
	`prompt` text,
	`exampleDataKey` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `report_feedback_id` PRIMARY KEY(`id`)
);
