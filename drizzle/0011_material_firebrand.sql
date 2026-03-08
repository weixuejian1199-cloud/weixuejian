ALTER TABLE `hr_payslip_records` MODIFY COLUMN `expiresAt` timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE `reports` MODIFY COLUMN `expiresAt` timestamp NOT NULL;