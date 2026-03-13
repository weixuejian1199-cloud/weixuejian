CREATE TABLE `result_sets` (
	`id` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`sessionId` varchar(64),
	`templateId` varchar(64),
	`computationVersion` varchar(32) NOT NULL,
	`sourceFiles` json NOT NULL,
	`filtersApplied` json,
	`skippedRowsCount` int NOT NULL DEFAULT 0,
	`skippedRowsSample` json,
	`metrics` json NOT NULL,
	`rowCount` int NOT NULL DEFAULT 0,
	`fields` json,
	`dataS3Key` varchar(512),
	`sourcePlatform` varchar(64),
	`isMultiFile` int NOT NULL DEFAULT 0,
	`cleaningLog` json,
	`generatedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `result_sets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `reports` ADD `resultSetId` varchar(64);--> statement-breakpoint
ALTER TABLE `openclaw_tasks` DROP COLUMN `errorMsg`;