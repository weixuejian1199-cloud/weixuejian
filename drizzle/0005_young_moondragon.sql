CREATE TABLE `openclaw_tasks` (
	`id` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`externalUserId` varchar(128),
	`message` text NOT NULL,
	`fileUrls` json,
	`fileNames` json,
	`reply` text,
	`outputFiles` json,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`errorMsg` text,
	`pickedUpAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `openclaw_tasks_id` PRIMARY KEY(`id`)
);
