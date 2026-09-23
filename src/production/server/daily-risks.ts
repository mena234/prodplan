import { evaluatePlan } from "../scheduler";
import { loadData } from "./workspace";
import { digest } from "./mutations";
import { getRuntime } from "./runtime";
import { isEmailDisabled } from "./email-mode";
import type { Notification } from "../types";
export async function refreshDateRisks(tenantId: string) {
  const data = await loadData(tenantId);
  if (!data.plan) return { notifications: 0, more: false };
  const env = getRuntime(),
    now = new Date(),
    timestamp = now.toISOString(),
    plan = evaluatePlan(
      data,
      data.plan.allocations,
      data.plan.risks,
      data.plan.strategy,
      now,
    );
  const candidates = plan.risks.filter(
    (r) =>
      ["deadline", "delay"].includes(r.code) &&
      !data.plan!.risks.some(
        (old) => old.id === r.id && old.message === r.message,
      ),
  );
  const changed: Array<(typeof candidates)[number] & { dedup: string }> = [];
  let scanned = 0;
  for (
    let offset = 0;
    offset < candidates.length && changed.length < 80;
    offset += 80
  ) {
    const chunk = await Promise.all(
      candidates.slice(offset, offset + 80).map(async (risk) => ({
        ...risk,
        dedup: `dated:${await digest([tenantId, risk.id, risk.message])}`,
      })),
    );
    const existing = await env.DB.prepare(
      `SELECT dedup_key FROM platform_notifications WHERE tenant_id=? AND dedup_key IN (${chunk.map(() => "?").join(",")})`,
    )
      .bind(tenantId, ...chunk.map((r) => r.dedup))
      .all<{ dedup_key: string }>();
    const keys = new Set(existing.results.map((r) => r.dedup_key));
    changed.push(...chunk.filter((r) => !keys.has(r.dedup)));
    scanned = offset + chunk.length;
  }
  const more = changed.length > 80 || scanned < candidates.length;
  changed.splice(80);
  const writes: D1PreparedStatement[] = [];
  for (const risk of changed) {
    const key = risk.dedup,
      order = data.orders.find((o) => o.id === risk.orderId)!;
    const notification: Notification = {
      id: crypto.randomUUID(),
      title: `${order.number}: delivery update`,
      message: risk.message,
      orderId: order.id,
      createdAt: timestamp,
      readAt: null,
      severity: risk.severity,
    };
    writes.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO platform_notifications(id,tenant_id,dedup_key,created_at,document) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM tenants WHERE id=? AND revision=?)",
      ).bind(
        notification.id,
        tenantId,
        key,
        timestamp,
        JSON.stringify(notification),
        tenantId,
        data.tenant.revision,
      ),
    );
  }
  if (changed.length && !isEmailDisabled(env)) {
    const recipients = await env.DB.prepare(
      "SELECT u.email FROM user u JOIN tenant_memberships m ON m.user_id=u.id WHERE m.tenant_id=? AND m.role IN('admin','planner') AND u.email_verified=1 LIMIT 250",
    )
      .bind(tenantId)
      .all<{ email: string }>();
    for (const recipient of recipients.results) {
      const key = await digest([
        tenantId,
        "dated-risk",
        recipient.email,
        changed.map((r) => r.dedup).sort(),
      ]);
      writes.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO email_outbox(id,tenant_id,dedup_key,recipient,subject,body,kind,status,attempts,next_attempt_at,created_at) SELECT ?,?,?,?,?,?,'notification','pending',0,?,? WHERE EXISTS(SELECT 1 FROM tenants WHERE id=? AND revision=?)",
        ).bind(
          crypto.randomUUID(),
          tenantId,
          key,
          recipient.email,
          `ProdPlan: ${changed.length} delivery update(s)`,
          `${data.tenant.name}\n\n${changed
            .slice(0, 20)
            .map(
              (r) =>
                `${data.orders.find((o) => o.id === r.orderId)?.number}: ${r.message}`,
            )
            .join(
              "\n\n",
            )}\n\nView all updates: ${env.BETTER_AUTH_URL}/app?unit=${tenantId}`,
          timestamp,
          timestamp,
          tenantId,
          data.tenant.revision,
        ),
      );
    }
  }
  if (!writes.length) return { notifications: 0, more };
  const results = await env.DB.batch(writes),
    notifications = results
      .slice(0, changed.length)
      .reduce((n, r) => n + r.meta.changes, 0);
  return { notifications, more: more || notifications === 0 };
}
