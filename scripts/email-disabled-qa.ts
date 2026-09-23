import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { testDb } from "./platform-test-db";
const base = "http://127.0.0.1:3018",
  browser = await chromium.launch({
    headless: true,
    executablePath:
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  }),
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { Origin: base },
  }),
  page = await context.newPage();
page.setDefaultTimeout(20000);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const email = `email-paused-${Date.now()}@example.test`,
  password = `Paused-Test-${crypto.randomUUID()}`;
const mailCount = () =>
  (
    testDb.prepare("SELECT COUNT(*) AS total FROM email_outbox").get() as {
      total: number;
    }
  ).total;
const before = mailCount();
try {
  await page.goto(`${base}/login?mode=reset&token=old-token`);
  await expect(
    page.getByRole("heading", { name: "Sign in to ProdPlan", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Forgot password?", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page.getByLabel("Your name").fill("Email paused QA");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Create your first workspace",
      exact: true,
    }),
  ).toBeVisible();
  const user = testDb
    .prepare("SELECT email_verified FROM user WHERE email=?")
    .get(email) as { email_verified: number };
  assert.equal(user.email_verified, 0);
  assert.equal(mailCount(), before);
  await page
    .getByLabel("Manufacturing unit", { exact: true })
    .fill("Email paused test unit");
  await page.locator("input[name=timezone]").fill("UTC");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Team", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Invite member", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Team invitations are paused while email is disabled.", {
      exact: true,
    }),
  ).toBeVisible();
  const units = await (
      await context.request.get(`${base}/api/platform/units`)
    ).json(),
    tenantId = units.memberships[0].tenantId;
  for (const endpoint of [
    "request-password-reset",
    "send-verification-email",
    "reset-password",
  ]) {
    const r = await context.request.post(`${base}/api/auth/${endpoint}`, {
      data: { email, token: "old-token", newPassword: password },
    });
    assert.equal(r.status(), 503);
    await r.body();
  }
  for (const body of [
    { action: "accept", token: "f".repeat(64) },
    {
      action: "invite",
      tenantId,
      revision: 0,
      email: "invited@example.test",
      role: "viewer",
    },
  ]) {
    const r = await context.request.post(`${base}/api/platform/team`, {
      data: body,
    });
    assert.equal(r.status(), 503);
    await r.body();
  }
  const foreign = testDb
    .prepare("SELECT id FROM tenants WHERE id<>? LIMIT 1")
    .get(tenantId) as { id: string };
  const denied = await context.request.get(
    `${base}/api/platform/workspace?tenantId=${foreign.id}`,
  );
  assert.equal(denied.status(), 403);
  await denied.body();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to ProdPlan", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  // A verified administrator still receives in-app risks, but no email is queued.
  const owner = JSON.parse(
      await fs.readFile("test-results/platform/account.json", "utf8"),
    ),
    flow = JSON.parse(
      await fs.readFile("test-results/platform/flow-summary.json", "utf8"),
    );
  const verified = await browser.newContext({
    storageState: owner.state,
    extraHTTPHeaders: { Origin: base },
  });
  const current = await (
    await verified.request.get(
      `${base}/api/platform/workspace?tenantId=${flow.unit}`,
    )
  ).json();
  const r = await verified.request.post(`${base}/api/platform/workspace`, {
    data: {
      tenantId: flow.unit,
      revision: current.tenant.revision,
      key: crypto.randomUUID(),
      action: "order.save",
      value: {
        number: `PAUSED-${Date.now()}`,
        customer: "Email pause check",
        productId: current.products[0].id,
        quantity: 1000,
        priority: "urgent",
        deadline: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      },
    },
  });
  const updated = await r.json();
  assert.equal(r.status(), 200, updated.error);
  assert.ok(updated.unreadCount > current.unreadCount);
  assert.equal(mailCount(), before);
  await verified.close();
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "test-results/platform/email-disabled-account.json",
    JSON.stringify({
      email,
      password,
      tenantId,
      state: await context.storageState(),
    }),
  );
  await page.screenshot({
    path: "test-results/platform/email-disabled.png",
    fullPage: true,
  });
  console.log(
    "Email-disabled browser/API checks passed: signup, unverified own-workspace access, password validation, tenant isolation, paused invitations/recovery, in-app alerts and zero queued emails.",
  );
} finally {
  await context.close();
  await browser.close();
  testDb.close();
}
