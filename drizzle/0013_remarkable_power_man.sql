CREATE TABLE `chat_conversations` (
	`id` varchar(64) NOT NULL,
	`userId` int NOT NULL DEFAULT 0,
	`sessionIds` json,
	`title` varchar(255),
	`messageCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chat_conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` varchar(64) NOT NULL,
	`conversationId` varchar(64) NOT NULL,
	`role` enum('user','assistant') NOT NULL,
	`content` text NOT NULL,
	`fileNames` json,
	`tokenEstimate` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `personal_templates` (
	`id` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`category` varchar(64) NOT NULL DEFAULT 'custom',
	`systemPrompt` text NOT NULL,
	`inputFields` json,
	`exampleOutput` json,
	`useCount` int NOT NULL DEFAULT 0,
	`lastUsedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `personal_templates_id` PRIMARY KEY(`id`)
);
