import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { testDb } from "./platform-test-db";
const base = "http://127.0.0.1:3018",
  account = JSON.parse(
    await fs.readFile(
      "test-results/platform/email-disabled-account.json",
      "utf8",
    ),
  );
const browser = await chromium.launch({
    headless: true,
    executablePath:
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  }),
  context = await browser.newContext({
    storageState: account.state,
    extraHTTPHeaders: { Origin: base },
  }),
  page = await context.newPage();
try {
  const denied = await context.request.get(
    `${base}/api/platform/workspace?tenantId=${account.tenantId}`,
  );
  assert.equal(denied.status(), 403);
  await denied.body();
  await page.goto(`${base}/login`);
  await expect(
    page.getByRole("button", { name: "Forgot password?", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Verify your email", exact: true }),
  ).toBeVisible();
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/api/auth/send-verification-email"),
  );
  await page
    .getByRole("button", { name: "Resend verification email", exact: true })
    .click();
  assert.equal((await response).status(), 200);
  const mail = testDb
    .prepare(
      "SELECT body FROM email_outbox WHERE recipient=? ORDER BY created_at DESC LIMIT 1",
    )
    .get(account.email) as { body: string };
  assert.ok(mail);
  const url = mail.body.match(/http:\/\/127\.0\.0\.1:3018\/[^\s]+/)?.[0];
  assert.ok(url);
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const verified = testDb
    .prepare("SELECT email_verified FROM user WHERE email=?")
    .get(account.email) as { email_verified: number };
  assert.equal(verified.email_verified, 1);
  console.log(
    "Email re-enable checks passed: existing unverified sessions are blocked, resend verification is reachable, and verification restores workspace access.",
  );
} finally {
  await context.close();
  await browser.close();
  testDb.close();
}
