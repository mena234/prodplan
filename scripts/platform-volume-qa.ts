import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { request } from "@playwright/test";
import { testDb } from "./platform-test-db";
import type { Workspace } from "../src/production/types";
const base = "http://127.0.0.1:3018",
  account = JSON.parse(
    await fs.readFile("test-results/platform/account.json", "utf8"),
  ),
  client = await request.newContext({
    baseURL: base,
    storageState: account.state,
    extraHTTPHeaders: { Origin: base },
    timeout: 120000,
  });
let data: Workspace;
async function post(path: string, payload: unknown) {
  const r = await client.post(path, { data: payload }),
    raw = await r.text();
  assert.equal(
    r.status(),
    path.endsWith("units") ? 201 : 200,
    raw.slice(0, 500),
  );
  return JSON.parse(raw);
}
async function mutate(action: object) {
  data = await post("/api/platform/workspace", {
    tenantId: data.tenant.id,
    revision: data.tenant.revision,
    key: crypto.randomUUID(),
    ...action,
  });
}
try {
  const { tenantId } = await post("/api/platform/units", {
    name: `Volume QA ${Date.now()}`,
    timeZone: "UTC",
    horizonDays: 30,
    dispatchBufferDays: 1,
  });
  data = await (
    await client.get(`/api/platform/workspace?tenantId=${tenantId}`)
  ).json();
  await mutate({
    action: "machine.save",
    value: {
      code: "VOLUME",
      name: "Volume work center",
      kind: "Production",
      dailyCapacityMinutes: 480,
      shifts: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        startMinute: 480,
        endMinute: 960,
      })),
      downtime: [],
    },
  });
  for (let i = 0; i < 50; i++)
    await mutate({
      action: "material.save",
      value: {
        code: `M-${i}`,
        name: `Raw material ${i} for the volume test with a practical descriptive name`,
        unit: "kg",
        stockMilli: 0,
        reorderMilli: 1000,
        leadTimeDays: 7,
      },
    });
  await mutate({
    action: "product.save",
    value: {
      sku: "VOLUME",
      name: "Volume product",
      bom: data.materials.map((m) => ({
        materialId: m.id,
        quantityMilliPerUnit: 1000,
      })),
      routing: Array.from({ length: 20 }, (_, i) => ({
        id: crypto.randomUUID(),
        name: `Stage ${i + 1}`,
        machineId: data.machines[0].id,
        minutesPerUnit: 1,
        setupMinutes: 0,
      })),
    },
  });
  const deadline = new Date(Date.now() + 7 * 86400000)
      .toISOString()
      .slice(0, 10),
    rows = Array.from({ length: 200 }, (_, i) => ({
      number: `V-${i}`,
      customer: "Volume test",
      productId: data.products[0].id,
      quantity: 1,
      priority: "normal",
      deadline,
    }));
  const start = performance.now();
  await mutate({ action: "order.import", rows });
  const importMs = Math.round(performance.now() - start);
  assert.equal(data.orders.length, 200);
  assert.ok(data.plan!.risks.length >= 10000);
  const planDoc = testDb
    .prepare(
      "SELECT document FROM plan_versions WHERE tenant_id=? ORDER BY revision DESC LIMIT 1",
    )
    .get(tenantId) as { document: string };
  assert.equal(JSON.parse(planDoc.document).storage, "parts-v1");
  const part = testDb
    .prepare(
      "SELECT MAX(LENGTH(CAST(content AS BLOB))) AS bytes FROM document_parts WHERE tenant_id=?",
    )
    .get(tenantId) as { bytes: number };
  assert.ok(part.bytes < 1000000);
  const audit = (
    await (
      await client.get(`/api/platform/activity?tenantId=${tenantId}&kind=audit`)
    ).json()
  ).items.find((a: { action: string }) => a.action === "order.import");
  assert.equal(audit.hasFullDetails, true);
  const full = await (
    await client.get(
      `/api/platform/activity?tenantId=${tenantId}&kind=audit&id=${audit.id}`,
    )
  ).json();
  assert.equal(full.item.after.length, 200);
  await mutate({ action: "plan.generate", strategy: "deadline" });
  assert.equal(data.orders.length, 200);
  const refreshed = await (
    await client.get(`/api/platform/workspace?tenantId=${tenantId}`)
  ).json();
  assert.equal(refreshed.plan.risks.length, data.plan!.risks.length);
  const notificationCount = testDb
    .prepare(
      "SELECT COUNT(*) AS total FROM platform_notifications WHERE tenant_id=?",
    )
    .get(tenantId) as { total: number };
  assert.ok(notificationCount.total >= 10000);
  await fs.writeFile(
    "test-results/platform/volume-summary.json",
    JSON.stringify({
      tenantId,
      orders: 200,
      stagesPerOrder: 20,
      bomLines: 50,
      risks: data.plan!.risks.length,
      importMs,
      largestStoredPart: part.bytes,
      passed: true,
    }),
  );
  console.log(
    `Volume test passed: 200 orders, 20 stages, 50 BOM lines, ${data.plan!.risks.length} risks; import ${importMs} ms, largest document part ${part.bytes} bytes; full audit and plan reload verified.`,
  );
} finally {
  await client.dispose();
  testDb.close();
}
