import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export * from "./production-schema";
export * from "./auth-schema";
export * from "./document-schema";
export * from "./demo-schema";
export const demoWorkspaces = sqliteTable("demo_workspaces", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  snapshot: text("snapshot").notNull(),
  updatedAt: text("updated_at").notNull(),
});
