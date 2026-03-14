ALTER TABLE `result_sets` ADD `resultSetId` varchar(64);--> statement-breakpoint
ALTER TABLE `result_sets` ADD `exportRowCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `result_sets` ADD `exportableFullData` int DEFAULT 0 NOT NULL;