import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { tenants } from "./production-schema";
export const documentParts = sqliteTable(
  "document_parts",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    kind: text("kind").notNull(),
    documentId: text("document_id").notNull(),
    partIndex: integer("part_index").notNull(),
    content: text("content").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.kind, t.documentId, t.partIndex] }),
  ],
);
