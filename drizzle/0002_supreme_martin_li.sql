ALTER TABLE `email_outbox` ADD `kind` text DEFAULT 'auth' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_invitations` ADD `accepted_by` text;--> statement-breakpoint
ALTER TABLE `tenant_invitations` ADD `revoked_at` text;