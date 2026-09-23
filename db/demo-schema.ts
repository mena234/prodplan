import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// Demo actors deliberately have no Better Auth user, account or session.
export const liveDemoSessions = sqliteTable(
  "live_demo_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    tenantId: text("tenant_id").notNull().unique(),
    actorId: text("actor_id").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("idx_live_demo_expiry").on(t.expiresAt)],
);
export const demoLimits = sqliteTable(
  "demo_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("idx_demo_limits_expiry").on(t.expiresAt)],
);
