CREATE TABLE `demo_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_demo_limits_expiry` ON `demo_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `live_demo_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_demo_sessions_tenant_id_unique` ON `live_demo_sessions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_live_demo_expiry` ON `live_demo_sessions` (`expires_at`);