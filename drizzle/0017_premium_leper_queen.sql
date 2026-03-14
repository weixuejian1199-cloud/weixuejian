ALTER TABLE `sessions` ADD `pipelineStatus` enum('running','success','failed');--> statement-breakpoint
ALTER TABLE `sessions` ADD `pipelineError` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `pipelineStartedAt` timestamp;--> statement-breakpoint
ALTER TABLE `sessions` ADD `pipelineFinishedAt` timestamp;