import { applyMutation, DomainError, permissionFor } from "../actions";
import { can } from "../permissions";
import { mutationSchema, type Mutation } from "../validation";
import type {
  AuditEntry,
  Notification,
  ProductionOrder,
  Role,
  Workspace,
} from "../types";
import { memberAccess } from "./access";
import { getRuntime } from "./runtime";
import { prepareDocument } from "./documents";
import { isEmailDisabled } from "./email-mode";
import { loadData, loadWorkspace } from "./workspace";
import { HttpError } from "./http";
import { demoOperation } from "./demo-session";
import { validateDemoAction } from "./demo-limits";

const json = (value: unknown) => JSON.stringify(value);
export async function digest(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(json(value)),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function mutate(
  headers: Headers,
  raw: unknown,
): Promise<Workspace> {
  const parsed = mutationSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
  const mutation = parsed.data,
    { tenantId, revision, key, ...action } = mutation;
  const permission = permissionFor(action),
    { user, demo } = await memberAccess(headers, tenantId, permission);
  const env = getRuntime(),
    db = env.DB,
    hash = await digest(action);
  const previous = await db
    .prepare(
      "SELECT digest FROM mutation_keys WHERE tenant_id=? AND actor_id=? AND key=?",
    )
    .bind(tenantId, user.id, key)
    .first<{ digest: string }>();
  if (previous) {
    if (previous.digest !== hash)
      throw new HttpError(
        409,
        "This request identifier was already used for another change.",
      );
    return loadWorkspace(headers, tenantId);
  }
  const current = await loadData(tenantId);
  if (demo) {
    await demoOperation(demo, "write");
    validateDemoAction(current, action);
  }
  if (current.tenant.revision !== revision)
    throw new HttpError(
      409,
      "The workspace changed in another session. Your draft is kept; review the latest data and try again.",
    );
  if (action.action === "record.delete" && action.kind === "material") {
    const movement = await db
      .prepare(
        "SELECT id FROM inventory_movements WHERE tenant_id=? AND material_id=? LIMIT 1",
      )
      .bind(tenantId, action.id)
      .first();
    if (movement)
      throw new HttpError(
        400,
        "This material has inventory history and must be retained.",
      );
  }
  let change: ReturnType<typeof applyMutation>;
  const now = new Date(),
    timestamp = now.toISOString(),
    nextRevision = revision + 1;
  try {
    change = applyMutation(current, action, user.id, now);
  } catch (error) {
    if (error instanceof DomainError || error instanceof Error)
      throw new HttpError(400, error.message);
    throw error;
  }
  const { data, movements, targetId, before, after } = change;
  if (
    data.orders.filter((order) => !order.completedAt && !order.cancelledAt)
      .length > 1000
  )
    throw new HttpError(
      400,
      "This unit has reached the limit of 1,000 active orders.",
    );
  data.tenant.revision = nextRevision;
  const roles = (["admin", "planner", "supervisor", "viewer"] as Role[]).filter(
    (role) => can(role, permission),
  );
  const roleClause = roles.map((role) => `'${role}'`).join(",");
  const guard =
    "EXISTS (SELECT 1 FROM tenants WHERE id=? AND revision=? AND last_mutation_id=?)";
  const attemptId = crypto.randomUUID();
  const guardValues = [tenantId, nextRevision, attemptId];
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE tenants SET revision=?,last_mutation_id=?,name=?,time_zone=?,horizon_days=?,dispatch_buffer_days=? WHERE id=? AND revision=? AND EXISTS (SELECT 1 FROM tenant_memberships WHERE tenant_id=? AND user_id=? AND role IN (${roleClause}))${demo ? " AND EXISTS(SELECT 1 FROM live_demo_sessions WHERE token_hash=? AND tenant_id=? AND expires_at>?)" : ""}`,
      )
      .bind(
        nextRevision,
        attemptId,
        data.tenant.name,
        data.tenant.timeZone,
        data.tenant.horizonDays,
        data.tenant.dispatchBufferDays,
        tenantId,
        revision,
        tenantId,
        user.id,
        ...(demo ? [demo.tokenHash, tenantId, Date.now()] : []),
      ),
  ];
  function sync(
    table: string,
    previousRecords: Array<{ id: string }>,
    nextRecords: Array<{ id: string }>,
    columns: string[],
    values: (record: { id: string }) => unknown[],
  ) {
    for (const record of nextRecords) {
      const old = previousRecords.find((item) => item.id === record.id);
      if (old && json(old) === json(record)) continue;
      const names = ["tenant_id", "id", ...columns, "document"];
      statements.push(
        db
          .prepare(
            `INSERT INTO ${table} (${names.join(",")}) SELECT ${names.map(() => "?").join(",")} WHERE ${guard} ON CONFLICT(tenant_id,id) DO UPDATE SET ${[...columns, "document"].map((column) => `${column}=excluded.${column}`).join(",")}`,
          )
          .bind(
            tenantId,
            record.id,
            ...values(record),
            json(record),
            ...guardValues,
          ),
      );
    }
    for (const old of previousRecords)
      if (!nextRecords.some((record) => record.id === old.id))
        statements.push(
          db
            .prepare(
              `DELETE FROM ${table} WHERE tenant_id=? AND id=? AND ${guard}`,
            )
            .bind(tenantId, old.id, ...guardValues),
        );
  }
  sync("work_centers", current.machines, data.machines, ["code"], (record) => [
    (record as Workspace["machines"][number]).code,
  ]);
  sync(
    "production_materials",
    current.materials,
    data.materials,
    ["code"],
    (record) => [(record as Workspace["materials"][number]).code],
  );
  sync(
    "production_products",
    current.products,
    data.products,
    ["sku"],
    (record) => [(record as Workspace["products"][number]).sku],
  );
  sync(
    "production_orders",
    current.orders,
    data.orders,
    ["number", "product_id", "deadline", "state"],
    (record) => {
      const order = record as ProductionOrder;
      return [
        order.number,
        order.productId,
        order.deadline,
        order.cancelledAt
          ? "cancelled"
          : order.completedAt
            ? "completed"
            : "active",
      ];
    },
  );
  sync(
    "purchase_receipts",
    current.receipts,
    data.receipts,
    ["material_id"],
    (record) => [(record as Workspace["receipts"][number]).materialId],
  );
  for (const movement of movements)
    statements.push(
      db
        .prepare(
          `INSERT INTO inventory_movements(id,tenant_id,material_id,created_at,document) SELECT ?,?,?,?,? WHERE ${guard}`,
        )
        .bind(
          movement.id,
          tenantId,
          movement.materialId,
          timestamp,
          json(movement),
          ...guardValues,
        ),
    );
  const storedPlan = data.plan
    ? prepareDocument(
        db,
        tenantId,
        "plan",
        String(nextRevision),
        data.plan,
        guard,
        guardValues,
      )
    : null;
  if (storedPlan) {
    statements.push(...storedPlan.writes);
    statements.push(
      db
        .prepare(
          `INSERT INTO plan_versions(tenant_id,revision,document,created_at) SELECT ?,?,?,? WHERE ${guard}`,
        )
        .bind(
          tenantId,
          nextRevision,
          storedPlan.document,
          timestamp,
          ...guardValues,
        ),
    );
  }
  const planSummary = (plan: Workspace["plan"], revision: number) =>
    plan
      ? {
          planRevision: revision,
          strategy: plan.strategy,
          score: plan.score,
          allocations: plan.allocations.length,
          risks: plan.risks.length,
        }
      : null;
  const audit: AuditEntry = {
    id: crypto.randomUUID(),
    actorId: user.id,
    actorName: user.name,
    action: action.action,
    targetId,
    createdAt: timestamp,
    before:
      action.action === "plan.generate" || action.action === "plan.move"
        ? planSummary(current.plan, revision)
        : before,
    after:
      action.action === "plan.generate" || action.action === "plan.move"
        ? { ...planSummary(data.plan, nextRevision), request: action }
        : after,
    revision: nextRevision,
  };
  const storedAudit = prepareDocument(
    db,
    tenantId,
    "audit",
    audit.id,
    audit,
    guard,
    guardValues,
    { ...audit, before: null, after: null, hasFullDetails: true },
  );
  statements.push(...storedAudit.writes);
  statements.push(
    db
      .prepare(
        `INSERT INTO audit_entries(id,tenant_id,actor_id,revision,created_at,action,document) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,
      )
      .bind(
        audit.id,
        tenantId,
        user.id,
        nextRevision,
        timestamp,
        action.action,
        storedAudit.document,
        ...guardValues,
      ),
  );
  statements.push(
    db
      .prepare(
        `INSERT INTO mutation_keys(tenant_id,actor_id,key,digest,revision,created_at) SELECT ?,?,?,?,?,? WHERE ${guard}`,
      )
      .bind(
        tenantId,
        user.id,
        key,
        hash,
        nextRevision,
        timestamp,
        ...guardValues,
      ),
  );
  const notifications: Notification[] = [];
  if (
    after &&
    typeof after === "object" &&
    "releasedSegments" in after &&
    Array.isArray(after.releasedSegments) &&
    after.releasedSegments.length
  )
    notifications.push({
      id: crypto.randomUUID(),
      title: "Production change released future locks",
      message: `${after.releasedSegments.length} queued segment(s) were unlocked to reflect the recorded floor event. Review the updated schedule.`,
      orderId: targetId,
      createdAt: timestamp,
      readAt: null,
      severity: "warning",
    });
  const oldRisks = new Set(
      current.plan?.risks.map((r) => json([r.id, r.message])) ?? [],
    ),
    orderMap = new Map(data.orders.map((o) => [o.id, o]));
  for (const risk of data.plan?.risks ?? []) {
    if (oldRisks.has(json([risk.id, risk.message]))) continue;
    const order = orderMap.get(risk.orderId)!;
    notifications.push({
      id: crypto.randomUUID(),
      title: `${order.number}: ${risk.code === "material" ? "Material availability" : risk.code === "capacity" ? "Capacity constraint" : risk.code === "hold" ? "Production on hold" : "Delivery risk"}`,
      message: risk.message,
      orderId: order.id,
      createdAt: timestamp,
      readAt: null,
      severity: risk.severity,
    });
  }
  if (action.action === "stage.update" && action.transition === "complete") {
    const order = data.orders.find((item) => item.id === action.orderId)!;
    notifications.push({
      id: crypto.randomUUID(),
      title: `${order.number}: ${order.completedAt ? "Production completed" : "Stage completed"}`,
      message: `${order.stages.find((stage) => stage.id === action.stageId)!.name} completed by ${user.name}.`,
      orderId: order.id,
      createdAt: timestamp,
      readAt: null,
      severity: "info",
    });
  }
  for (let offset = 0; offset < notifications.length; offset += 80) {
    const chunk = await Promise.all(
      notifications.slice(offset, offset + 80).map(async (notification) => ({
        id: notification.id,
        dedup: await digest([
          nextRevision,
          notification.title,
          notification.message,
        ]),
        document: json(notification),
      })),
    );
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO platform_notifications(id,tenant_id,dedup_key,created_at,document) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.dedup'),?,json_extract(value,'$.document') FROM json_each(?) WHERE ${guard}`,
        )
        .bind(tenantId, timestamp, json(chunk), ...guardValues),
    );
  }
  // One digest email per mutation, only to verified administrators/planners.
  if (notifications.length && !demo && !isEmailDisabled(env)) {
    const recipients = await db
      .prepare(
        "SELECT u.email FROM tenant_memberships m JOIN user u ON u.id=m.user_id WHERE m.tenant_id=? AND m.role IN ('admin','planner') AND u.email_verified=1",
      )
      .bind(tenantId)
      .all<{ email: string }>();
    for (const recipient of recipients.results) {
      const emailId = crypto.randomUUID(),
        dedup = await digest([tenantId, nextRevision, recipient.email]);
      const body = `${data.tenant.name}\n\n${notifications
        .slice(0, 20)
        .map((item) => `${item.title}\n${item.message}`)
        .join(
          "\n\n",
        )}\n\nOpen ProdPlan: ${env.BETTER_AUTH_URL}/app?unit=${tenantId}`;
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO email_outbox(id,tenant_id,dedup_key,recipient,subject,body,kind,status,attempts,next_attempt_at,created_at) SELECT ?,?,?,?,?,?,'notification','pending',0,?,? WHERE ${guard}`,
          )
          .bind(
            emailId,
            tenantId,
            dedup,
            recipient.email,
            `ProdPlan: ${notifications.length} production update${notifications.length === 1 ? "" : "s"}`,
            body,
            timestamp,
            timestamp,
            ...guardValues,
          ),
      );
    }
  }
  const results = await db.batch(statements);
  if (results[0].meta.changes !== 1) {
    const saved = await db
      .prepare(
        "SELECT digest FROM mutation_keys WHERE tenant_id=? AND actor_id=? AND key=?",
      )
      .bind(tenantId, user.id, key)
      .first<{ digest: string }>();
    if (!saved || saved.digest !== hash)
      throw new HttpError(
        409,
        "The workspace changed while saving. Your draft is kept; review the latest data and try again.",
      );
  }
  return loadWorkspace(headers, tenantId);
}
export type { Mutation };
