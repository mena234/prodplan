CREATE TABLE `document_parts` (
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`document_id` text NOT NULL,
	`part_index` integer NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `kind`, `document_id`, `part_index`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
