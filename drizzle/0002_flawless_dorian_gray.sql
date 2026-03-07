CREATE TABLE `invite_records` (
	`id` varchar(64) NOT NULL,
	`inviterUserId` int NOT NULL,
	`inviteeUserId` int NOT NULL,
	`inviteCode` varchar(16) NOT NULL,
	`inviterCredits` int NOT NULL DEFAULT 500,
	`inviteeCredits` int NOT NULL DEFAULT 500,
	`status` enum('pending','completed') NOT NULL DEFAULT 'completed',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invite_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `inviteCode` varchar(16);--> statement-breakpoint
ALTER TABLE `users` ADD `invitedBy` varchar(16);--> statement-breakpoint
ALTER TABLE `users` ADD `credits` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_inviteCode_unique` UNIQUE(`inviteCode`);