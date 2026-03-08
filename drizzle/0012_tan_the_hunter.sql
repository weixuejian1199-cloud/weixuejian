CREATE TABLE `im_conversations` (
	`id` varchar(64) NOT NULL,
	`type` enum('direct','ai') NOT NULL,
	`lastMessage` text,
	`lastMessageAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `im_conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `im_messages` (
	`id` varchar(64) NOT NULL,
	`conversationId` varchar(64) NOT NULL,
	`senderId` int NOT NULL,
	`senderName` varchar(128),
	`type` enum('text','file','ai_thinking') NOT NULL DEFAULT 'text',
	`content` text NOT NULL,
	`fileInfo` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `im_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `im_participants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`unreadCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `im_participants_id` PRIMARY KEY(`id`)
);
