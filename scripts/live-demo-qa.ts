import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  chromium,
  expect as baseExpect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import type { Workspace } from "../src/production/types";
import type { Action } from "../src/production/validation";
import { addDays, localDay } from "../src/production/dates";

// Local-only security/functional QA. The only direct writes below set test demo
// expiry/quota fixtures; all production actions use the application's real API.
const base = "http://127.0.0.1:3018",
  expect = baseExpect.configure({ timeout: 15000 });
const folder = path.resolve(".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const files = (await fs.readdir(folder)).filter((s) =>
  /^[a-f0-9]{64}\.sqlite$/.test(s),
);
assert.equal(files.length, 1);
const db = new DatabaseSync(path.join(folder, files[0]));
db.exec("PRAGMA busy_timeout=5000");
db.prepare("DELETE FROM demo_limits WHERE key LIKE 'creation:%'").run();
const account = JSON.parse(
  await fs.readFile("test-results/platform/account.json", "utf8"),
);
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const contexts: BrowserContext[] = [],
  errors: string[] = [],
  checks: string[] = [];
function record(...messages: string[]) {
  checks.push(...messages);
  console.log(messages.join("; "));
}
async function context(mobile = false, real = false) {
  const ctx = await browser.newContext({
    ...(real ? { storageState: account.state } : {}),
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
    isMobile: mobile,
    hasTouch: mobile,
  });
  contexts.push(ctx);
  return ctx;
}
async function page(ctx: BrowserContext) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.setDefaultTimeout(15000);
  return p;
}
const headers = { Origin: base, "x-prodplan-demo": "1" };
async function snapshot(ctx: BrowserContext, id: string) {
  const r = await ctx.request.get(
    `${base}/api/platform/workspace?tenantId=${id}`,
    { headers },
  );
  assert.equal(r.status(), 200, await r.text());
  return r.json() as Promise<Workspace>;
}
async function mutate(
  ctx: BrowserContext,
  id: string,
  action: Action,
  expected = 200,
) {
  const data = await snapshot(ctx, id);
  const r = await ctx.request.post(`${base}/api/platform/workspace`, {
    headers,
    data: {
      tenantId: id,
      revision: data.tenant.revision,
      key: crypto.randomUUID(),
      ...action,
    },
  });
  assert.equal(r.status(), expected, await r.text());
  return r.json() as Promise<Workspace>;
}
async function navigate(p: Page, name: string) {
  await p
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name, exact: true })
    .click();
}
async function skip(p: Page) {
  const dialog = p.locator("dialog.product-tour");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Skip tour", exact: true }).click();
}
async function start(ctx: BrowserContext) {
  const p = await page(ctx);
  await p.goto(base, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Try live demo", exact: true }).click();
  await expect(p.locator("dialog.product-tour")).toBeVisible();
  return { p, id: new URL(p.url()).searchParams.get("unit")! };
}
const tenantCount = () =>
  Number(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM tenants WHERE id NOT IN (SELECT tenant_id FROM live_demo_sessions)",
        )
        .get() as { n: number }
    ).n,
  );
try {
  const owner = await context(false, true),
    a = await context(),
    b = await context(true);
  const realUnits = (await (
    await owner.request.get(`${base}/api/platform/units`)
  ).json()) as { memberships: Array<{ tenantId: string }> };
  assert(
    realUnits.memberships.length > 0,
    "Existing authenticated account still loads",
  );
  const realId = realUnits.memberships[0].tenantId;
  const realBefore = await (
    await owner.request.get(`${base}/api/platform/workspace?tenantId=${realId}`)
  ).json();
  const realCount = tenantCount();
  const aa = await start(a),
    bb = await start(b);
  assert.notEqual(aa.id, bb.id);
  let da = await snapshot(a, aa.id);
  const dbb = await snapshot(b, bb.id);
  assert.equal(da.machines.length, 3);
  assert.equal(da.orders.length, 4);
  assert.equal(da.plan?.startDate, localDay(da.tenant.timeZone));
  assert(da.plan?.risks.some((r) => r.code === "material"));
  assert(da.plan?.risks.some((r) => r.code === "deadline"));
  assert.equal(da.integrations.ai, false);
  assert.equal(da.integrations.email, false);
  assert.notEqual(da.products[0].id, dbb.products[0].id);
  const cookie = (await a.cookies()).find(
    (c) => c.name === "prodplan-live-demo",
  )!;
  assert(cookie.httpOnly && cookie.sameSite === "Lax");
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM user WHERE id=?")
        .get(da.user.id) as { n: number }
    ).n,
    0,
    "No auth user created by a demo",
  );
  record(
    "two private sample plants, current dates, risk examples, no auth account",
  );

  await aa.p
    .locator("dialog.product-tour")
    .getByRole("button", { name: "Show me around" })
    .click();
  await expect(aa.p.locator("dialog.product-tour")).toContainText(
    "four steel brackets",
  );
  await aa.p.reload({ waitUntil: "networkidle" });
  await expect(aa.p.locator("dialog.product-tour")).toContainText(
    "four steel brackets",
  );
  for (let i = 0; i < 5; i++)
    await aa.p
      .locator("dialog.product-tour")
      .getByRole("button", { name: "Next", exact: true })
      .click();
  await aa.p
    .locator("dialog.product-tour")
    .getByRole("button", { name: "Go to overview" })
    .click();
  await skip(bb.p);
  await bb.p.screenshot({
    path: "test-results/platform/live-demo-phone.png",
    fullPage: true,
  });
  assert(
    await bb.p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  record("practical tour, resume, mobile layout");

  for (const target of [bb.id, realId]) {
    for (const route of [
      `workspace?tenantId=${target}`,
      `activity?tenantId=${target}`,
      `reports?tenantId=${target}&format=pdf`,
      `team?tenantId=${target}`,
    ])
      assert.equal(
        (
          await a.request.get(`${base}/api/platform/${route}`, { headers })
        ).status(),
        403,
        route,
      );
    assert.equal(
      (
        await a.request.post(`${base}/api/platform/workspace`, {
          headers,
          data: {
            tenantId: target,
            revision: 0,
            key: crypto.randomUUID(),
            action: "plan.generate",
          },
        })
      ).status(),
      403,
    );
    assert.equal(
      (
        await a.request.post(`${base}/api/platform/optimize`, {
          headers,
          data: { tenantId: target, revision: 0 },
        })
      ).status(),
      403,
    );
    assert.equal(
      (
        await a.request.post(`${base}/api/platform/notifications`, {
          headers,
          data: { tenantId: target },
        })
      ).status(),
      403,
    );
  }
  assert.equal(
    (await a.request.get(`${base}/api/platform/units`)).status(),
    401,
    "Demo cookie never acts as real authentication",
  );
  assert.equal(
    (
      await owner.request.get(
        `${base}/api/platform/workspace?tenantId=${aa.id}`,
      )
    ).status(),
    403,
  );
  assert.equal(
    (
      await a.request.post(`${base}/api/platform/units`, {
        headers,
        data: { name: "Forbidden" },
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await a.request.post(`${base}/api/platform/team`, {
        headers,
        data: {
          action: "invite",
          tenantId: aa.id,
          email: "nobody@example.test",
          role: "viewer",
          revision: 0,
        },
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await a.request.post(`${base}/api/demo`, {
        headers: { Origin: "https://unrelated.example" },
        data: {},
      })
    ).status(),
    403,
  );
  record(
    "cross-visitor and real-tenant reads/writes/exports/notifications/optimization denied",
    "real authentication and CSRF preserved",
  );

  await navigate(aa.p, "Orders");
  await aa.p.getByRole("button", { name: "Create order", exact: true }).click();
  await aa.p.getByLabel("Order reference", { exact: true }).fill("TRY-001");
  await aa.p.getByLabel("Customer", { exact: true }).fill("Visitor trial");
  const bracket = da.products.find((p) => p.sku === "BRACKET")!;
  await aa.p.getByLabel("Product", { exact: true }).selectOption(bracket.id);
  await aa.p.getByLabel("Quantity", { exact: true }).fill("4");
  await aa.p.getByLabel("Priority", { exact: true }).selectOption("urgent");
  await aa.p
    .getByLabel("Delivery deadline", { exact: true })
    .fill(addDays(localDay(da.tenant.timeZone), 2));
  const saved = aa.p.waitForResponse(
    (r) =>
      r.url().endsWith("/api/platform/workspace") &&
      r.request().method() === "POST",
  );
  await aa.p
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  assert.equal((await saved).status(), 200);
  await expect(aa.p.getByRole("dialog")).toHaveCount(0);
  da = await snapshot(a, aa.id);
  let order = da.orders.find((o) => o.number === "TRY-001")!;
  assert(order && da.plan?.allocations.some((j) => j.orderId === order.id));
  await aa.p.reload({ waitUntil: "networkidle" });
  assert.equal(new URL(aa.p.url()).searchParams.get("unit"), aa.id);
  assert.equal((await snapshot(b, bb.id)).orders.length, 4);
  await mutate(a, aa.id, {
    action: "order.save",
    value: {
      id: order.id,
      number: order.number,
      customer: "Updated visitor",
      productId: bracket.id,
      quantity: 4,
      priority: "urgent",
      deadline: order.deadline,
    },
  });
  record("real UI order creation, editing and refresh persistence");

  da = await snapshot(a, aa.id);
  const finish = da.plan!.allocations.find(
    (j) => j.orderId === order.id && j.stageId === order.stages[1].id,
  )!;
  await mutate(a, aa.id, {
    action: "plan.move",
    allocationId: finish.id,
    date: addDays(da.plan!.startDate, 2),
    startMinute: 575,
    locked: true,
  });
  da = await snapshot(a, aa.id);
  assert(
    da.plan!.allocations.some(
      (j) => j.orderId === order.id && j.startMinute === 575 && j.locked,
    ),
  );
  const shifted = da.plan!.allocations.find(
    (j) => j.orderId === order.id && j.stageId === order.stages[1].id,
  )!;
  await mutate(a, aa.id, {
    action: "plan.lock",
    allocationId: shifted.id,
    locked: false,
  });
  await mutate(a, aa.id, { action: "plan.generate", strategy: "priority" });
  for (const stage of order.stages) {
    await mutate(a, aa.id, {
      action: "stage.update",
      orderId: order.id,
      stageId: stage.id,
      transition: "start",
    });
    await mutate(a, aa.id, {
      action: "stage.update",
      orderId: order.id,
      stageId: stage.id,
      transition: "progress",
      completedQuantity: 2,
      setupCompleted: true,
    });
    await mutate(a, aa.id, {
      action: "stage.update",
      orderId: order.id,
      stageId: stage.id,
      transition: "hold",
      reason: "Check dimensions",
    });
    await mutate(a, aa.id, {
      action: "stage.update",
      orderId: order.id,
      stageId: stage.id,
      transition: "resume",
    });
    await mutate(a, aa.id, {
      action: "stage.update",
      orderId: order.id,
      stageId: stage.id,
      transition: "complete",
    });
  }
  da = await snapshot(a, aa.id);
  order = da.orders.find((o) => o.id === order.id)!;
  assert(order.completedAt && order.materialsIssued);
  assert.equal(
    da.materials.find((m) => m.code === "STEEL")!.stockMilli,
    492000,
  );
  const alu = da.materials.find((m) => m.code === "ALU")!;
  da = await mutate(a, aa.id, {
    action: "inventory.adjust",
    materialId: alu.id,
    stockMilli: 40000,
    reason: "Demo stock count",
  });
  assert(!da.plan!.risks.some((r) => r.code === "material"));
  assert(da.plan!.risks.some((r) => r.code === "deadline"));
  record(
    "exact-minute schedule persistence",
    "stage start/progress/hold/resume/completion and one-time stock issue",
    "stock correction updates actual constraints",
  );

  await aa.p.reload({ waitUntil: "networkidle" });
  await navigate(aa.p, "Planning board");
  await aa.p.screenshot({ path: "test-results/platform/live-demo-board.png" });
  await aa.p
    .getByRole("button", { name: "Compare schedules", exact: true })
    .click();
  await expect(aa.p.getByRole("dialog")).toContainText(
    "Paid AI calls are disabled",
  );
  await expect(aa.p.getByRole("dialog").locator("tbody tr")).toHaveCount(4);
  await aa.p
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  for (const format of ["csv", "schedule", "pdf"]) {
    const r = await a.request.get(
      `${base}/api/platform/reports?tenantId=${aa.id}&demo=1&format=${format}`,
    );
    assert.equal(r.status(), 200);
    const bytes = await r.body();
    assert(
      format === "pdf"
        ? bytes.toString().startsWith("%PDF")
        : bytes
            .toString()
            .includes(format === "schedule" ? "DEMO-002" : "TRY-001"),
      `The ${format} export contains the expected production data`,
    );
  }
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM email_outbox WHERE tenant_id IN (?,?)",
        )
        .get(aa.id, bb.id) as { n: number }
    ).n,
    0,
  );
  record(
    "deterministic comparison with provider configured, CSV/schedule/PDF reports, zero demo email",
  );

  await mutate(
    a,
    aa.id,
    {
      action: "order.save",
      value: {
        number: "TOO-LARGE",
        customer: "Test",
        productId: bracket.id,
        quantity: 100000,
        priority: "normal",
        deadline: order.deadline,
      },
    },
    400,
  );
  const hash = (
    db
      .prepare(
        "SELECT token_hash AS hash FROM live_demo_sessions WHERE tenant_id=?",
      )
      .get(aa.id) as { hash: string }
  ).hash;
  db.prepare("UPDATE demo_limits SET count=5,expires_at=? WHERE key=?").run(
    Date.now() + 60000,
    `session:${hash}:compare`,
  );
  assert.equal(
    (
      await a.request.post(`${base}/api/platform/optimize`, {
        headers,
        data: { tenantId: aa.id, revision: da.tenant.revision },
      })
    ).status(),
    429,
  );
  record("server workload and comparison rate limits");

  await aa.p.getByRole("button", { name: "Reset demo", exact: true }).click();
  await aa.p
    .getByRole("button", { name: "Keep my changes", exact: true })
    .click();
  assert.equal((await snapshot(a, aa.id)).orders.length, 5);
  await aa.p.getByRole("button", { name: "Reset demo", exact: true }).click();
  await aa.p
    .getByRole("button", { name: "Reset sample plant", exact: true })
    .click();
  await expect(aa.p.locator("dialog.product-tour")).toBeVisible();
  const resetId = new URL(aa.p.url()).searchParams.get("unit")!;
  assert.notEqual(resetId, aa.id);
  const reset = await snapshot(a, resetId);
  assert.equal(reset.orders.length, 4);
  assert.equal(reset.demo?.expiresAt, da.demo?.expiresAt);
  assert.equal(
    db.prepare("SELECT id FROM tenants WHERE id=?").get(aa.id),
    undefined,
  );
  assert.equal((await snapshot(b, bb.id)).tenant.revision, dbb.tenant.revision);
  await skip(aa.p);
  record(
    "reset confirmation, complete removal of old demo, unchanged other visitor, unchanged expiry",
  );

  db.prepare(
    "UPDATE live_demo_sessions SET expires_at=? WHERE tenant_id=?",
  ).run(Date.now() - 1, bb.id);
  db.prepare("UPDATE demo_limits SET expires_at=0 WHERE key='cleanup'").run();
  assert.equal(
    (
      await b.request.get(`${base}/api/platform/workspace?tenantId=${bb.id}`, {
        headers,
      })
    ).status(),
    410,
  );
  await bb.p.reload({ waitUntil: "networkidle" });
  await expect(
    bb.p.getByText("Your temporary demo has expired.", { exact: false }),
  ).toBeVisible();
  await expect
    .poll(() => !!db.prepare("SELECT id FROM tenants WHERE id=?").get(bb.id))
    .toBe(false);
  await bb.p.getByRole("button", { name: "Try live demo", exact: true }).tap();
  await expect(bb.p.locator("dialog.product-tour")).toBeVisible();
  assert.notEqual(new URL(bb.p.url()).searchParams.get("unit"), bb.id);
  assert.equal(
    (
      await b.request.get(`${base}/api/platform/workspace?tenantId=${bb.id}`, {
        headers,
      })
    ).status(),
    403,
  );
  record("server expiry, automatic deletion, clear restart");

  const ownerDemo = await owner.request.post(`${base}/api/demo`, {
    headers: { Origin: base },
    data: {},
  });
  assert.equal(ownerDemo.status(), 201);
  assert.deepEqual(
    (
      (await (
        await owner.request.get(`${base}/api/platform/units`)
      ).json()) as { memberships: unknown }
    ).memberships,
    realUnits.memberships,
  );
  const realAfter = (await (
    await owner.request.get(`${base}/api/platform/workspace?tenantId=${realId}`)
  ).json()) as Workspace;
  assert.deepEqual(realAfter, realBefore);
  assert.equal(tenantCount(), realCount);
  record(
    "demo and real auth cookies coexist without changing real customer data",
  );
  const login = await page(owner);
  await login.goto(`${base}/login`);
  await login.getByLabel("Email", { exact: true }).fill(account.email);
  await login.getByLabel("Password", { exact: true }).fill(account.password);
  await login.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(login.locator(".p-sidebar")).toBeVisible();
  assert(!new URL(login.url()).searchParams.has("demo"));
  record("existing email/password sign-in");

  await aa.p
    .getByRole("link", { name: "Create your own workspace", exact: true })
    .first()
    .click();
  await expect(
    aa.p.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();
  await aa.p.getByLabel("Your name").fill("Demo conversion QA");
  await aa.p
    .getByLabel("Email", { exact: true })
    .fill(`conversion-${Date.now()}@example.test`);
  await aa.p
    .getByLabel("Password", { exact: true })
    .fill(`Local-conversion-${crypto.randomUUID()}`);
  await aa.p
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    aa.p.getByRole("heading", { name: "Create your first workspace" }),
  ).toBeVisible();
  const conversion = (await (
    await a.request.get(`${base}/api/platform/units`)
  ).json()) as { memberships: unknown[] };
  assert.deepEqual(conversion.memberships, []);
  assert.equal((await snapshot(a, resetId)).orders.length, 4);
  record(
    "registration available; new real account receives no sample workspace",
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "test-results/platform/live-demo-summary.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(`Live demo QA passed: ${checks.length} checks`);
} catch (e) {
  console.error(e);
  for (let i = 0; i < contexts.length; i++)
    for (const p of contexts[i].pages())
      await p
        .screenshot({
          path: `test-results/platform/live-demo-failure-${i}.png`,
          timeout: 5000,
        })
        .catch(() => {});
  throw e;
} finally {
  await Promise.all(contexts.map((c) => c.close()));
  await browser.close();
  db.close();
}
