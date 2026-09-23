ALTER TABLE `email_outbox` ADD `provider_id` text;--> statement-breakpoint
ALTER TABLE `email_outbox` ADD `delivered_at` text;--> statement-breakpoint
ALTER TABLE `email_outbox` ADD `provider_event_at` integer;