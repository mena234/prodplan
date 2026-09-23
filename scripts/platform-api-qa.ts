import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { request, type APIRequestContext } from "@playwright/test";
import { testDb } from "./platform-test-db";
import type { Workspace, Role } from "../src/production/types";
const base = "http://127.0.0.1:3018",
  account = JSON.parse(
    await fs.readFile("test-results/platform/account.json", "utf8"),
  );

const owner = await request.newContext({
    baseURL: base,
    storageState: account.state,
    extraHTTPHeaders: { Origin: base },
    timeout: 20000,
  }),
  member = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
    timeout: 20000,
  }),
  anonymous = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
    timeout: 20000,
  });
let checks = 0;
async function post(
  client: APIRequestContext,
  path: string,
  body: unknown,
  status = 200,
) {
  const r = await client.post(path, { data: body }),
    data = await r.json();
  assert.equal(
    r.status(),
    status,
    JSON.stringify({
      path,
      status: r.status(),
      error: data.error ?? data.message,
    }),
  );
  checks++;
  return data;
}
async function get(client: APIRequestContext, path: string, status = 200) {
  const r = await client.get(path);
  assert.equal(r.status(), status, path);
  checks++;
  return r.json();
}
async function workspace(
  client: APIRequestContext,
  id: string,
): Promise<Workspace> {
  return get(client, `/api/platform/workspace?tenantId=${id}`);
}
async function mutation(
  client: APIRequestContext,
  id: string,
  action: object,
  status = 200,
) {
  const data = await workspace(client, id);
  return post(
    client,
    "/api/platform/workspace",
    {
      tenantId: id,
      revision: data.tenant.revision,
      key: crypto.randomUUID(),
      ...action,
    },
    status,
  );
}
async function latestMail(email: string, subject: string) {
  const row = testDb
    .prepare(
      "SELECT body FROM email_outbox WHERE recipient=? AND subject=? ORDER BY created_at DESC LIMIT 1",
    )
    .get(email, subject) as { body: string } | undefined;
  assert.ok(row);
  return row.body;
}
const makeUnit = (client: APIRequestContext, name: string) =>
  post(
    client,
    "/api/platform/units",
    { name, timeZone: "UTC", horizonDays: 30, dispatchBufferDays: 1 },
    201,
  );
try {
  const email = `member-${Date.now()}@example.test`,
    password = `Member-Test-${crypto.randomUUID()}`;
  await post(member, "/api/auth/sign-up/email", {
    name: "Role test member",
    email,
    password,
    callbackURL: `${base}/app`,
  });
  await post(member, "/api/auth/sign-in/email", { email, password }, 403);
  const verify = (await latestMail(email, "Verify your ProdPlan email")).match(
    /http:\/\/127\.0\.0\.1:3018\/[^\s]+/,
  )?.[0];
  assert.ok(verify);
  await member.get(verify);
  const signed = await post(member, "/api/auth/sign-in/email", {
    email,
    password,
  });
  const memberId = signed.user.id;
  const alpha = (await makeUnit(owner, `API Alpha ${Date.now()}`)).tenantId,
    beta = (await makeUnit(member, `API Beta ${Date.now()}`)).tenantId;
  for (const path of [
    `workspace?tenantId=${alpha}`,
    `team?tenantId=${alpha}`,
    `activity?tenantId=${alpha}`,
    `reports?tenantId=${alpha}&format=csv`,
  ])
    await get(anonymous, `/api/platform/${path}`, 401);
  await get(owner, `/api/platform/workspace?tenantId=${beta}`, 403);
  await get(member, `/api/platform/workspace?tenantId=${alpha}`, 403);
  let a = await workspace(owner, alpha);
  await post(owner, "/api/platform/team", {
    tenantId: alpha,
    revision: a.tenant.revision,
    action: "invite",
    email,
    role: "viewer",
  });
  const token = (await latestMail(email, "Your ProdPlan invitation")).match(
    /invite=([a-f0-9]{64})/,
  )?.[1];
  assert.ok(token);
  await post(member, "/api/platform/team", { action: "accept", token });
  await post(member, "/api/platform/team", { action: "accept", token });
  a = await workspace(owner, alpha);
  assert.equal((await workspace(member, alpha)).role, "viewer");
  const material = {
    id: crypto.randomUUID(),
    code: "TEST-STEEL",
    name: "Test steel",
    unit: "kg",
    stockMilli: 10000,
    reorderMilli: 1000,
    leadTimeDays: 3,
  };
  const createValue = { ...material, id: undefined };
  const alphaMat = await mutation(owner, alpha, {
    action: "material.save",
    value: createValue,
  });
  const materialId = alphaMat.materials[0].id;
  const betaMat = await mutation(member, beta, {
    action: "material.save",
    value: { ...createValue, code: "BETA-ONLY" },
  });
  const foreignMaterial = betaMat.materials[0].id;
  for (const role of ["viewer", "supervisor", "planner"] as Role[]) {
    a = await workspace(owner, alpha);
    await post(owner, "/api/platform/team", {
      tenantId: alpha,
      revision: a.tenant.revision,
      action: "role",
      userId: memberId,
      role,
    });
    const current = await workspace(member, alpha);
    await post(
      member,
      "/api/platform/workspace",
      {
        tenantId: alpha,
        revision: current.tenant.revision,
        key: crypto.randomUUID(),
        action: "inventory.adjust",
        materialId,
        stockMilli: current.materials[0].stockMilli + 1000,
        reason: "Role check",
      },
      role === "planner" ? 200 : 403,
    );
    await post(
      member,
      "/api/platform/workspace",
      {
        tenantId: alpha,
        revision: (await workspace(member, alpha)).tenant.revision,
        key: crypto.randomUUID(),
        action: "stage.update",
        orderId: crypto.randomUUID(),
        stageId: crypto.randomUUID(),
        transition: "start",
      },
      role === "supervisor" ? 400 : 403,
    );
    await get(member, `/api/platform/team?tenantId=${alpha}`, 403);
    await get(member, `/api/platform/activity?tenantId=${alpha}`, 403);
    await get(member, `/api/platform/workspace?tenantId=${beta}`, 200);
  }
  await mutation(
    member,
    alpha,
    {
      action: "receipt.save",
      value: {
        materialId: foreignMaterial,
        quantityMilli: 1000,
        expectedDate: new Date().toISOString().slice(0, 10),
        reference: "Cross-unit",
      },
    },
    400,
  );
  a = await workspace(owner, alpha);
  const receipt = (
    await mutation(owner, alpha, {
      action: "receipt.save",
      value: {
        materialId,
        quantityMilli: 1250,
        expectedDate: new Date().toISOString().slice(0, 10),
        reference: "PO-IDEMPOTENT",
      },
    })
  ).receipts[0];
  a = await workspace(owner, alpha);
  const payload = {
    tenantId: alpha,
    revision: a.tenant.revision,
    key: crypto.randomUUID(),
    action: "receipt.receive",
    receiptId: receipt.id,
  };
  const responses = await Promise.all([
    owner.post("/api/platform/workspace", { data: payload }),
    owner.post("/api/platform/workspace", { data: payload }),
  ]);
  for (const r of responses) {
    const body = await r.json();
    assert.equal(r.status(), 200, body.error);
    checks++;
  }
  const received = await workspace(owner, alpha);
  assert.equal(
    received.materials[0].stockMilli,
    a.materials[0].stockMilli + 1250,
  );
  const movementCount = testDb
    .prepare(
      "SELECT COUNT(*) AS total FROM inventory_movements WHERE tenant_id=? AND json_extract(document,'$.receiptId')=?",
    )
    .get(alpha, receipt.id) as { total: number };
  assert.equal(movementCount?.total, 1);
  checks++;
  await post(
    owner,
    "/api/platform/workspace",
    {
      ...payload,
      action: "inventory.adjust",
      materialId,
      stockMilli: 999,
      reason: "Key reuse",
    },
    409,
  );
  a = await workspace(owner, alpha);
  const sameKey = crypto.randomUUID(),
    common = {
      tenantId: alpha,
      revision: a.tenant.revision,
      key: sameKey,
      action: "inventory.adjust",
      materialId,
      reason: "Concurrent actors",
    };
  const cross = await Promise.all([
    owner.post("/api/platform/workspace", {
      data: { ...common, stockMilli: 18000 },
    }),
    member.post("/api/platform/workspace", {
      data: { ...common, stockMilli: 19000 },
    }),
  ]);
  const codes = cross.map((r) => r.status()).sort();
  for (const r of cross) await r.body();
  assert.deepEqual(codes, [200, 409]);
  checks++;
  const crossRow = testDb
    .prepare(
      "SELECT COUNT(*) AS total FROM mutation_keys WHERE tenant_id=? AND key=?",
    )
    .get(alpha, sameKey) as { total: number };
  assert.equal(crossRow?.total, 1);
  checks++;
  const wrongOrigin = await owner.post("/api/platform/workspace", {
    headers: { Origin: "https://untrusted.example" },
    data: payload,
  });
  assert.equal(wrongOrigin.status(), 403);
  await wrongOrigin.body();
  await get(owner, `/api/platform/workspace?tenantId=${alpha}`);
  checks++;
  const huge = await owner.post("/api/auth/sign-in/email", {
    data: { email, password, padding: "x".repeat(70000) },
  });
  assert.equal(huge.status(), 413);
  await huge.body();
  checks++;
  await get(owner, "/api/health");
  const report = await member.get(
    `/api/platform/reports?tenantId=${alpha}&format=csv`,
  );
  assert.equal(report.status(), 200);
  await report.body();
  checks++;
  a = await workspace(owner, alpha);
  const compared = await post(member, "/api/platform/optimize", {
    tenantId: alpha,
    revision: a.tenant.revision,
  });
  assert.equal(compared.candidates.length, 4);
  assert.match(compared.source, /Deterministic/);
  checks++;
  await post(anonymous, "/api/platform/maintenance", {}, 401);
  const memberWorkspace = await workspace(member, beta);
  await post(
    member,
    "/api/platform/team",
    {
      tenantId: beta,
      revision: memberWorkspace.tenant.revision,
      action: "role",
      userId: memberId,
      role: "viewer",
    },
    409,
  );
  a = await workspace(owner, alpha);
  await post(owner, "/api/platform/team", {
    tenantId: alpha,
    revision: a.tenant.revision,
    action: "role",
    userId: memberId,
    role: "admin",
  });
  a = await workspace(owner, alpha);
  const race = await Promise.all([
    owner.post("/api/platform/team", {
      data: {
        tenantId: alpha,
        revision: a.tenant.revision,
        action: "role",
        userId: a.user.id,
        role: "viewer",
      },
    }),
    member.post("/api/platform/team", {
      data: {
        tenantId: alpha,
        revision: a.tenant.revision,
        action: "role",
        userId: memberId,
        role: "viewer",
      },
    }),
  ]);
  for (const r of race) await r.body();
  assert.deepEqual(race.map((r) => r.status()).sort(), [200, 409]);
  const admins = testDb
    .prepare(
      "SELECT COUNT(*) AS total FROM tenant_memberships WHERE tenant_id=? AND role='admin'",
    )
    .get(alpha) as { total: number };
  assert.equal(admins?.total, 1);
  checks++;
  await post(member, "/api/auth/request-password-reset", {
    email,
    redirectTo: `base/login?mode=reset`.replace("base", base),
  });
  const reset = (await latestMail(email, "Reset your ProdPlan password")).match(
    /http:\/\/127\.0\.0\.1:3018\/[^\s]+/,
  )?.[0];
  assert.ok(reset);
  const resetResponse = await member.get(reset, { maxRedirects: 0 });
  const location = resetResponse.headers().location;
  assert.ok(location);
  const resetToken = new URL(location).searchParams.get("token");
  assert.ok(resetToken);
  const newPassword = `Reset-Test-${crypto.randomUUID()}`;
  await post(anonymous, "/api/auth/reset-password", {
    token: resetToken,
    newPassword,
  });
  await get(member, "/api/platform/units", 401);
  await post(member, "/api/auth/sign-in/email", { email, password }, 401);
  await post(member, "/api/auth/sign-in/email", {
    email,
    password: newPassword,
  });
  await post(
    anonymous,
    "/api/auth/reset-password",
    { token: resetToken, newPassword },
    400,
  );
  await fs.writeFile(
    "test-results/platform/api-summary.json",
    JSON.stringify({ checks, passed: true, alpha, beta }),
  );
  console.log(
    `${checks} API checks passed: tenant isolation, role matrix, invitations, idempotency, concurrent actors, final-admin protection, origin/body limits, reports, comparison, password recovery and session revocation.`,
  );
} finally {
  await owner.dispose();
  await member.dispose();
  await anonymous.dispose();
  testDb.close();
}
