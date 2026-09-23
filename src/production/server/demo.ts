import { demoSeed } from "../demo-seed";
import { getRuntime } from "./runtime";
import { HttpError } from "./http";
import {
  cleanupDemos,
  deleteDemoTenant,
  DEMO_COOKIE,
  DEMO_TTL_MS,
  demoLimit,
  demoOperation,
  getDemoSession,
  hashSecret,
  requireDemoSession,
} from "./demo-session";

export async function openDemo(
  request: Request,
  options: { reset?: boolean; timeZone?: string },
) {
  const env = getRuntime(),
    now = Date.now();
  const existing = options.reset
    ? await requireDemoSession(request.headers)
    : await getDemoSession(request.headers);
  if (existing && !options.reset)
    return Response.json({ url: `/app?demo=1&unit=${existing.tenantId}` });
  if (options.reset && existing) await demoOperation(existing, "reset");
  else {
    await demoLimit(env, "creation:global-minute", 20, 60000);
    await demoLimit(env, "creation:global-day", 300, 86400000);
    const ip = request.headers.get("cf-connecting-ip") ?? "local";
    await demoLimit(
      env,
      `creation:ip:${await hashSecret(`${env.BETTER_AUTH_SECRET}:${ip}`)}`,
      5,
      3600000,
    );
  }
  await cleanupDemos(env);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const hash = existing?.tokenHash ?? (await hashSecret(token)),
    tenantId = crypto.randomUUID(),
    actorId = existing?.actorId ?? crypto.randomUUID(),
    expiresAt = existing?.expiresAt ?? now + DEMO_TTL_MS;
  const data = demoSeed(
    tenantId,
    actorId,
    options.timeZone ?? "UTC",
    new Date(now),
  );
  const db = env.DB;
  const guard =
      "EXISTS(SELECT 1 FROM live_demo_sessions WHERE token_hash=? AND tenant_id=? AND expires_at>?)",
    values = [hash, tenantId, now];
  const writes = [
    existing
      ? db
          .prepare(
            "UPDATE live_demo_sessions SET tenant_id=? WHERE token_hash=? AND tenant_id=? AND expires_at>?",
          )
          .bind(tenantId, hash, existing.tenantId, now)
      : db
          .prepare(
            "INSERT INTO live_demo_sessions(token_hash,tenant_id,actor_id,created_at,expires_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM live_demo_sessions)<500",
          )
          .bind(hash, tenantId, actorId, now, expiresAt),
  ];
  if (existing)
    writes.push(...deleteDemoTenant(env, existing.tenantId, guard, values));
  writes.push(
    db
      .prepare(
        `INSERT INTO tenants(id,name,time_zone,horizon_days,dispatch_buffer_days,revision,created_at) SELECT ?,?,?,14,1,0,? WHERE ${guard}`,
      )
      .bind(
        tenantId,
        data.tenant.name,
        data.tenant.timeZone,
        data.tenant.createdAt,
        ...values,
      ),
    db
      .prepare(
        `INSERT INTO tenant_memberships(tenant_id,user_id,role,created_at) SELECT ?,?,'admin',? WHERE ${guard}`,
      )
      .bind(tenantId, actorId, data.tenant.createdAt, ...values),
  );
  for (const [table, records, column] of [
    ["work_centers", data.machines, "code"],
    ["production_materials", data.materials, "code"],
    ["production_products", data.products, "sku"],
  ] as const)
    for (const record of records)
      writes.push(
        db
          .prepare(
            `INSERT INTO ${table}(tenant_id,id,${column},document) SELECT ?,?,?,? WHERE ${guard}`,
          )
          .bind(
            tenantId,
            record.id,
            "code" in record ? record.code : record.sku,
            JSON.stringify(record),
            ...values,
          ),
      );
  for (const order of data.orders)
    writes.push(
      db
        .prepare(
          `INSERT INTO production_orders(tenant_id,id,number,product_id,deadline,state,document) SELECT ?,?,?,?,?,'active',? WHERE ${guard}`,
        )
        .bind(
          tenantId,
          order.id,
          order.number,
          order.productId,
          order.deadline,
          JSON.stringify(order),
          ...values,
        ),
    );
  for (const receipt of data.receipts)
    writes.push(
      db
        .prepare(
          `INSERT INTO purchase_receipts(tenant_id,id,material_id,document) SELECT ?,?,?,? WHERE ${guard}`,
        )
        .bind(
          tenantId,
          receipt.id,
          receipt.materialId,
          JSON.stringify(receipt),
          ...values,
        ),
    );
  writes.push(
    db
      .prepare(
        `INSERT INTO plan_versions(tenant_id,revision,document,created_at) SELECT ?,0,?,? WHERE ${guard}`,
      )
      .bind(
        tenantId,
        JSON.stringify(data.plan),
        data.tenant.createdAt,
        ...values,
      ),
  );
  for (const risk of data.plan?.risks ?? []) {
    const notification = {
      id: crypto.randomUUID(),
      title: `${data.orders.find((o) => o.id === risk.orderId)!.number}: ${risk.code === "material" ? "Material shortage" : "Delivery risk"}`,
      message: risk.message,
      orderId: risk.orderId,
      createdAt: data.tenant.createdAt,
      readAt: null,
      severity: risk.severity,
    };
    writes.push(
      db
        .prepare(
          `INSERT INTO platform_notifications(id,tenant_id,dedup_key,created_at,document) SELECT ?,?,?,?,? WHERE ${guard}`,
        )
        .bind(
          notification.id,
          tenantId,
          notification.id,
          data.tenant.createdAt,
          JSON.stringify(notification),
          ...values,
        ),
    );
  }
  const results = await db.batch(writes);
  if (!results[0].meta.changes)
    throw new HttpError(
      existing ? 409 : 429,
      existing
        ? "The demo changed in another tab. Refresh and try again."
        : "The live demo is busy. Please try again later.",
    );
  return Response.json(
    {
      url: `/app?demo=1&unit=${tenantId}`,
      expiresAt: new Date(expiresAt).toISOString(),
    },
    {
      status: 201,
      headers: existing
        ? {}
        : {
            "Set-Cookie": `${DEMO_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DEMO_TTL_MS / 1000}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
          },
    },
  );
}
