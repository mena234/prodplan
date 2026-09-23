import { HttpError } from "./http";
import { getRuntime, type Runtime } from "./runtime";

export const DEMO_COOKIE = "prodplan-live-demo";
export const DEMO_TTL_MS = 24 * 60 * 60 * 1000;
export interface DemoSession {
  tokenHash: string;
  tenantId: string;
  actorId: string;
  createdAt: number;
  expiresAt: number;
}
export const demoRequest = (headers: Headers) =>
  headers.get("x-prodplan-demo") === "1";
export async function hashSecret(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function demoToken(headers: Headers) {
  const matches = (headers.get("cookie") ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith(`${DEMO_COOKIE}=`));
  const token =
    matches.length === 1 ? matches[0].slice(DEMO_COOKIE.length + 1) : "";
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export async function getDemoSession(
  headers: Headers,
  env = getRuntime(),
  now = Date.now(),
) {
  const token = demoToken(headers);
  if (!token) return null;
  return env.DB.prepare(
    "SELECT token_hash AS tokenHash,tenant_id AS tenantId,actor_id AS actorId,created_at AS createdAt,expires_at AS expiresAt FROM live_demo_sessions WHERE token_hash=? AND expires_at>?",
  )
    .bind(await hashSecret(token), now)
    .first<DemoSession>();
}
export async function requireDemoSession(headers: Headers) {
  const session = await getDemoSession(headers);
  if (!session)
    throw new HttpError(
      410,
      "This temporary demo has expired. Start a fresh demo to continue.",
      "DEMO_EXPIRED",
    );
  return session;
}
export async function demoLimit(
  env: Runtime,
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
) {
  const allowed = await env.DB.prepare(
    "INSERT INTO demo_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END WHERE expires_at<=? OR count<? RETURNING count",
  )
    .bind(key, now + windowMs, now, now, now, max)
    .first();
  if (!allowed)
    throw new HttpError(
      429,
      "This demo has reached a temporary usage limit. Please try again later or create your own workspace.",
    );
}
export async function demoOperation(
  session: DemoSession,
  kind: "read" | "write" | "compare" | "report" | "reset",
) {
  const env = getRuntime();
  const max = { read: 120, write: 30, compare: 5, report: 10, reset: 3 }[kind];
  const window = kind === "reset" ? 3600000 : 60000;
  await demoLimit(env, `session:${session.tokenHash}:${kind}`, max, window);
  if (kind !== "read" && kind !== "reset")
    await demoLimit(
      env,
      `session:${session.tokenHash}:total-${kind}`,
      kind === "write" ? 200 : kind === "compare" ? 30 : 50,
      Math.max(1, session.expiresAt - Date.now()),
    );
}

// Every delete is scoped both to the tenant and a still-valid cleanup/reset guard.
export function deleteDemoTenant(
  env: Runtime,
  tenantId: string,
  guard: string,
  values: (string | number)[],
) {
  const db = env.DB;
  return [
    db
      .prepare(
        `DELETE FROM notification_reads WHERE notification_id IN (SELECT id FROM platform_notifications WHERE tenant_id=?) AND ${guard}`,
      )
      .bind(tenantId, ...values),
    ...[
      "inventory_movements",
      "purchase_receipts",
      "production_orders",
      "production_products",
      "production_materials",
      "work_centers",
      "plan_versions",
      "audit_entries",
      "mutation_keys",
      "tenant_invitations",
      "email_outbox",
      "document_parts",
      "platform_notifications",
      "tenant_memberships",
    ].map((table) =>
      db
        .prepare(`DELETE FROM ${table} WHERE tenant_id=? AND ${guard}`)
        .bind(tenantId, ...values),
    ),
    db
      .prepare(`DELETE FROM tenants WHERE id=? AND ${guard}`)
      .bind(tenantId, ...values),
  ];
}
export async function cleanupDemos(env: Runtime, now = Date.now()) {
  // One database lease bounds sweeps across concurrent Worker isolates.
  const lease = await env.DB.prepare(
    "INSERT INTO demo_limits(key,count,expires_at) VALUES('cleanup',1,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE expires_at<=? RETURNING key",
  )
    .bind(now + 60000, now)
    .first();
  if (!lease) return 0;
  const expired = await env.DB.prepare(
    "SELECT tenant_id AS tenantId,token_hash AS tokenHash FROM live_demo_sessions WHERE expires_at<=? ORDER BY expires_at LIMIT 20",
  )
    .bind(now)
    .all<{ tenantId: string; tokenHash: string }>();
  for (const session of expired.results) {
    const guard =
      "EXISTS(SELECT 1 FROM live_demo_sessions WHERE token_hash=? AND tenant_id=? AND expires_at<=?)";
    await env.DB.batch([
      ...deleteDemoTenant(env, session.tenantId, guard, [
        session.tokenHash,
        session.tenantId,
        now,
      ]),
      env.DB.prepare(
        "DELETE FROM live_demo_sessions WHERE token_hash=? AND tenant_id=? AND expires_at<=?",
      ).bind(session.tokenHash, session.tenantId, now),
    ]);
  }
  await env.DB.prepare(
    "DELETE FROM demo_limits WHERE key IN (SELECT key FROM demo_limits WHERE expires_at<=? LIMIT 500)",
  )
    .bind(now)
    .run();
  return expired.results.length;
}
