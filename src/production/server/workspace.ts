import { getRuntime } from "./runtime";
import { memberAccess, userMemberships } from "./access";
import { emailReady } from "./mail";
import { HttpError } from "./http";
import type { Tenant, Workspace } from "../types";
import { evaluatePlan } from "../scheduler";
import { readDocument } from "./documents";
import { isEmailDisabled } from "./email-mode";
import { demoOperation } from "./demo-session";

export type Data = Pick<
  Workspace,
  | "tenant"
  | "machines"
  | "materials"
  | "products"
  | "orders"
  | "receipts"
  | "plan"
>;
export async function loadData(tenantId: string): Promise<Data> {
  const db = getRuntime().DB;
  const results = await db.batch([
    db
      .prepare(
        "SELECT id,name,time_zone AS timeZone,horizon_days AS horizonDays,dispatch_buffer_days AS dispatchBufferDays,revision,created_at AS createdAt FROM tenants WHERE id=?",
      )
      .bind(tenantId),
    ...[
      "work_centers",
      "production_materials",
      "production_products",
      "production_orders",
      "purchase_receipts",
    ].map((table) =>
      db
        .prepare(`SELECT document FROM ${table} WHERE tenant_id=? ORDER BY id`)
        .bind(tenantId),
    ),
    db
      .prepare(
        "SELECT document,revision FROM plan_versions WHERE tenant_id=? ORDER BY revision DESC LIMIT 1",
      )
      .bind(tenantId),
  ]);
  const tenant = results[0].results[0] as unknown as Tenant;
  const savedPlan = results[6].results[0] as
    { revision: number; document: string } | undefined;
  if (!tenant) throw new HttpError(404, "This workspace does not exist.");
  const documents = (index: number) =>
    results[index].results.map((row) =>
      JSON.parse((row as { document: string }).document),
    );
  return {
    tenant,
    machines: documents(1),
    materials: documents(2),
    products: documents(3),
    orders: documents(4),
    receipts: documents(5),
    plan: savedPlan
      ? await readDocument(
          db,
          tenantId,
          "plan",
          String(savedPlan.revision),
          savedPlan.document,
        )
      : null,
  };
}
export async function loadWorkspace(
  headers: Headers,
  tenantId: string,
): Promise<Workspace> {
  const { user, role, demo } = await memberAccess(headers, tenantId);
  if (demo) await demoOperation(demo, "read");
  const env = getRuntime();
  const [data, memberships, notifications, unread] = await Promise.all([
    loadData(tenantId),
    userMemberships(user.id),
    env.DB.prepare(
      "SELECT n.document,r.read_at AS readAt FROM platform_notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=? WHERE n.tenant_id=? ORDER BY n.created_at DESC LIMIT 100",
    )
      .bind(user.id, tenantId)
      .all<{ document: string; readAt: string | null }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM platform_notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=? WHERE n.tenant_id=? AND r.read_at IS NULL",
    )
      .bind(user.id, tenantId)
      .first<{ total: number }>(),
  ]);
  if (data.plan) {
    const current = evaluatePlan(
      data,
      data.plan.allocations,
      data.plan.risks,
      data.plan.strategy,
    );
    data.plan = {
      ...current,
      startDate: data.plan.startDate,
      endDate: data.plan.endDate,
      generatedAt: data.plan.generatedAt,
    };
  }
  return {
    ...data,
    ...(demo
      ? { demo: { expiresAt: new Date(demo.expiresAt).toISOString() } }
      : {}),
    role,
    user,
    memberships,
    notifications: notifications.results.map((row) => ({
      ...JSON.parse(row.document),
      readAt: row.readAt,
    })),
    unreadCount: unread?.total ?? 0,
    integrations: {
      email: !demo && emailReady(env),
      ai: !demo && !!env.OPENROUTER_API_KEY,
      emailDisabled: !!demo || isEmailDisabled(env),
    },
  };
}
