import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { testDb } from "./platform-test-db";
const base = "http://127.0.0.1:3018";

const browser = await chromium.launch({
  headless: true,
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
page.setDefaultTimeout(12000);
const email = `platform-${Date.now()}@example.test`,
  password = `Local-Test-${crypto.randomUUID()}`;
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await fs.mkdir("test-results/platform", { recursive: true });
  await page.goto(`${base}/login`);
  await page
    .getByRole("button", { name: "Create an account", exact: true })
    .click();
  await page.getByLabel("Your name").fill("Platform QA");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.locator("input[type=password]").fill(password);
  const signup = page.waitForResponse((r) =>
    r.url().endsWith("/api/auth/sign-up/email"),
  );
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const response = await signup;
  console.log("Signup status", response.status());
  if (response.status() !== 200) console.log(await response.text());
  await expect(
    page.getByRole("heading", { name: "Verify your email" }),
  ).toBeVisible();
  const mail = testDb
    .prepare(
      "SELECT body FROM email_outbox WHERE recipient=? AND subject='Verify your ProdPlan email' ORDER BY created_at DESC LIMIT 1",
    )
    .get(email) as { body: string } | undefined;
  assert.ok(mail, "Verification email captured in local outbox");
  const link = mail.body.match(/http:\/\/127\.0\.0\.1:3018\/[^\s]+/)?.[0];
  assert.ok(link);
  await page.goto(link);
  await page.goto(`${base}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.locator("input[type=password]").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Create your first workspace" }),
  ).toBeVisible();
  await page
    .getByLabel("Manufacturing unit", { exact: true })
    .fill("QA Manufacturing");
  await page.locator("input[name=timezone]").fill("UTC");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/platform/empty-workspace.png",
    fullPage: true,
  });
  await fs.writeFile(
    "test-results/platform/account.json",
    JSON.stringify({ email, password, state: await context.storageState() }),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Account signup, captured verification, login and workspace creation passed.",
  );
} catch (e) {
  await page.screenshot({
    path: "test-results/platform/auth-failure.png",
    fullPage: true,
  });
  console.log("Visible page:", await page.locator("body").innerText());
  throw e;
} finally {
  await context.close();
  await browser.close();
  testDb.close();
}
