import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/sqlite-core";

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timeZone: text("time_zone").notNull(),
  horizonDays: integer("horizon_days").notNull().default(30),
  dispatchBufferDays: integer("dispatch_buffer_days").notNull().default(1),
  revision: integer("revision").notNull().default(0),
  lastMutationId: text("last_mutation_id"),
  createdAt: text("created_at").notNull(),
});
export const memberships = sqliteTable(
  "tenant_memberships",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId] }),
    index("idx_memberships_user").on(t.userId),
  ],
);
export const invitations = sqliteTable(
  "tenant_invitations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    email: text("email").notNull(),
    role: text("role").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    acceptedAt: text("accepted_at"),
    acceptedBy: text("accepted_by"),
    revokedAt: text("revoked_at"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_invitations_token").on(t.tokenHash),
    index("idx_invitations_tenant").on(t.tenantId),
  ],
);
export const workCenters = sqliteTable(
  "work_centers",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    id: text("id").notNull(),
    code: text("code").notNull(),
    document: text("document").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex("idx_centers_tenant_code").on(t.tenantId, t.code),
  ],
);
export const productionMaterials = sqliteTable(
  "production_materials",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    id: text("id").notNull(),
    code: text("code").notNull(),
    document: text("document").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex("idx_materials_tenant_code").on(t.tenantId, t.code),
  ],
);
export const productionProducts = sqliteTable(
  "production_products",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    id: text("id").notNull(),
    sku: text("sku").notNull(),
    document: text("document").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex("idx_products_tenant_sku").on(t.tenantId, t.sku),
  ],
);
export const productionOrders = sqliteTable(
  "production_orders",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    id: text("id").notNull(),
    number: text("number").notNull(),
    productId: text("product_id").notNull(),
    deadline: text("deadline").notNull(),
    state: text("state").notNull(),
    document: text("document").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex("idx_orders_tenant_number").on(t.tenantId, t.number),
    index("idx_orders_tenant_deadline").on(t.tenantId, t.deadline),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [productionProducts.tenantId, productionProducts.id],
    }),
  ],
);
export const purchaseReceipts = sqliteTable(
  "purchase_receipts",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    id: text("id").notNull(),
    materialId: text("material_id").notNull(),
    document: text("document").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.materialId],
      foreignColumns: [productionMaterials.tenantId, productionMaterials.id],
    }),
  ],
);
export const inventoryMovements = sqliteTable(
  "inventory_movements",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    materialId: text("material_id").notNull(),
    createdAt: text("created_at").notNull(),
    document: text("document").notNull(),
  },
  (t) => [
    index("idx_inventory_tenant_created").on(t.tenantId, t.createdAt),
    foreignKey({
      columns: [t.tenantId, t.materialId],
      foreignColumns: [productionMaterials.tenantId, productionMaterials.id],
    }),
  ],
);
export const planVersions = sqliteTable(
  "plan_versions",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    revision: integer("revision").notNull(),
    document: text("document").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.revision] })],
);
export const auditEntries = sqliteTable(
  "audit_entries",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    actorId: text("actor_id").notNull(),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
    action: text("action").notNull(),
    document: text("document").notNull(),
  },
  (t) => [index("idx_audit_tenant_created").on(t.tenantId, t.createdAt)],
);
export const platformNotifications = sqliteTable(
  "platform_notifications",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    dedupKey: text("dedup_key").notNull(),
    createdAt: text("created_at").notNull(),
    document: text("document").notNull(),
  },
  (t) => [
    uniqueIndex("idx_notifications_dedup").on(t.tenantId, t.dedupKey),
    index("idx_notifications_tenant_created").on(t.tenantId, t.createdAt),
  ],
);
export const notificationReads = sqliteTable(
  "notification_reads",
  {
    notificationId: text("notification_id")
      .notNull()
      .references(() => platformNotifications.id),
    userId: text("user_id").notNull(),
    readAt: text("read_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.notificationId, t.userId] })],
);
export const emailOutbox = sqliteTable(
  "email_outbox",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").references(() => tenants.id),
    dedupKey: text("dedup_key").notNull(),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    kind: text("kind").notNull().default("auth"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: text("next_attempt_at").notNull(),
    createdAt: text("created_at").notNull(),
    sentAt: text("sent_at"),
    lastError: text("last_error"),
    providerId: text("provider_id"),
    deliveredAt: text("delivered_at"),
    providerEventAt: integer("provider_event_at"),
  },
  (t) => [
    uniqueIndex("idx_outbox_dedup").on(t.dedupKey),
    index("idx_outbox_due").on(t.status, t.nextAttemptAt),
    index("idx_outbox_tenant").on(t.tenantId),
  ],
);
export const mutationKeys = sqliteTable(
  "mutation_keys",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    actorId: text("actor_id").notNull(),
    key: text("key").notNull(),
    digest: text("digest").notNull(),
    revision: integer("revision").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.actorId, t.key] })],
);
