import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect as baseExpect } from "@playwright/test";
import type { Workspace } from "../src/production/types";
const base = "http://127.0.0.1:3018",
  account = JSON.parse(
    await fs.readFile("test-results/platform/account.json", "utf8"),
  );
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const context = await browser.newContext({
    storageState: account.state,
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
page.setDefaultTimeout(20000);
const expect = baseExpect.configure({ timeout: 20000 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
async function save() {
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/platform/workspace") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  const r = await response;
  assert.equal(r.status(), 200, await r.text());
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function nav(name: string) {
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button")
    .filter({ hasText: name })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
async function snapshot(): Promise<Workspace> {
  return (
    await context.request.get(`${base}/api/platform/workspace?tenantId=${unit}`)
  ).json();
}
let unit = "";
try {
  await page.goto(`${base}/app`);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  const unitName = `UI flow ${Date.now()}`;
  await page
    .getByRole("button", { name: "Add workspace", exact: true })
    .click();
  await page.getByRole("dialog").locator("input[name=name]").fill(unitName);
  await page.getByRole("dialog").locator("input[name=timezone]").fill("UTC");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  unit = (
    await (await context.request.get(`${base}/api/platform/units`)).json()
  ).memberships.find((m: { name: string }) => m.name === unitName).tenantId;
  await nav("Work centers");
  assert.ok((await page.locator(".p-page-header").boundingBox())!.y < 80);
  for (const [code, name] of [
    ["LASER", "Laser cutting"],
    ["FINISH", "Finishing line"],
  ]) {
    await page
      .getByRole("button", { name: "Add work center", exact: true })
      .click();
    const d = page.getByRole("dialog");
    await d.locator("input[name=code]").fill(code);
    await d.locator("input[name=name]").fill(name);
    await d.locator("input[name=capacity]").fill("1440");
    await d.getByRole("button", { name: "Add shift", exact: true }).click();
    await d.getByRole("button", { name: "Add shift", exact: true }).click();
    const rows = d.locator(".p-shift-editor");
    for (let i = 0; i < 7; i++) {
      const row = rows.nth(i);
      await row.getByLabel("Day", { exact: true }).selectOption(String(i));
      await row.getByLabel(/shift start .* hours/).selectOption("0");
      await row.getByLabel(/shift start .* minutes/).selectOption("0");
      await row.getByLabel(/shift end .* hours/).selectOption("24");
      await expect(row.getByLabel(/shift end .* minutes/)).toHaveValue("0");
      await expect(row.getByLabel(/shift end .* minutes/)).toBeDisabled();
    }
    await save();
  }
  await nav("Materials & stock");
  await page.getByRole("button", { name: "Add material", exact: true }).click();
  let d = page.getByRole("dialog");
  await d.locator("input[name=code]").fill("STEEL");
  await d.locator("input[name=name]").fill("Sheet steel");
  await d.locator("input[name=stock]").fill("100");
  await d.locator("input[name=reorder]").fill("10");
  await save();
  await nav("Products & BOM");
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  d = page.getByRole("dialog");
  await d.locator("input[name=sku]").fill("BRACKET");
  await d.locator("input[name=name]").fill("Steel bracket");
  let stage = d.locator(".p-stage-editor").first();
  await stage.locator("input").nth(0).fill("Cutting");
  await stage.getByRole("combobox").selectOption({ label: "Laser cutting" });
  await stage.locator("input").nth(1).fill("10");
  await stage.locator("input").nth(2).fill("20");
  await d.getByRole("button", { name: "Add stage", exact: true }).click();
  stage = d.locator(".p-stage-editor").nth(1);
  await stage.locator("input").nth(0).fill("Finishing");
  await stage.getByRole("combobox").selectOption({ label: "Finishing line" });
  await stage.locator("input").nth(1).fill("10");
  await save();
  await nav("Orders");
  await page.getByRole("button", { name: "Create order", exact: true }).click();
  d = page.getByRole("dialog");
  await d.locator("input[name=number]").fill("QA-001");
  await d.locator("input[name=customer]").fill("Pilot customer");
  await d
    .locator("select[name=product]")
    .selectOption({ label: "BRACKET · Steel bracket" });
  await d.locator("input[name=quantity]").fill("4");
  await save();
  await expect(
    page.getByRole("button", { name: "QA-001", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "QA-001", exact: true }).click();
  await expect(page.locator(".p-stage-duration").nth(0)).toContainText(
    "60 min",
  );
  await expect(page.locator(".p-stage-duration").nth(1)).toContainText(
    "40 min",
  );
  await page.keyboard.press("Escape");
  let data = await snapshot();
  assert.equal(data.orders.length, 1);
  assert.equal(data.plan!.allocations.length, 2);
  assert.equal(data.plan!.risks.length, 0);
  await nav("Planning board");
  await page.screenshot({
    path: "test-results/platform/plan-desktop.png",
    fullPage: true,
  });
  const last = data.plan!.allocations.find(
    (a) =>
      data.orders[0].stages.find((s) => s.id === a.stageId)?.name ===
      "Finishing",
  )!;
  await page
    .getByRole("button", { name: new RegExp("^QA-001, Finishing,") })
    .click();
  d = page.getByRole("dialog");
  const tomorrow = new Date(Date.parse(last.date + "T00:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
  await d.locator("input[name=date]").fill(tomorrow);
  await d.getByLabel("Time placement").selectOption("available");
  await save();
  data = await snapshot();
  assert.ok(
    data.plan!.allocations.some(
      (a) => a.stageId === last.stageId && a.date === tomorrow,
    ),
  );
  await page.getByLabel("Calendar date").fill(tomorrow);
  await page
    .getByRole("button", { name: new RegExp("^QA-001, Finishing,") })
    .click();
  d = page.getByRole("dialog");
  await d.locator("input[name=date]").fill(last.date);
  await d.getByLabel("Time placement").selectOption("available");
  await save();
  await nav("Production floor");
  await page
    .getByRole("button", { name: "Start stage", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Put on hold", exact: true }),
  ).toBeVisible();
  data = await snapshot();
  assert.equal(data.materials[0].stockMilli, 96000);
  assert.equal(data.orders[0].materialsIssued, true);
  await page
    .getByRole("button", { name: "Update progress", exact: true })
    .click();
  d = page.getByRole("dialog");
  await d.locator("input[name=quantity]").fill("1");
  await save();
  await page.getByRole("button", { name: "Put on hold", exact: true }).click();
  d = page.getByRole("dialog");
  await d.locator("textarea[name=reason]").fill("Tool inspection");
  await save();
  await expect(
    page.getByText("Tool inspection", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Complete stage", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Complete stage", exact: true })
    .click();
  await save();
  await page.getByRole("button", { name: "Start stage", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Complete stage", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Complete stage", exact: true })
    .click();
  await save();
  await nav("Orders");
  await page.getByRole("button", { name: "QA-001", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm delivery", exact: true })
    .click();
  await save();
  data = await snapshot();
  assert.ok(data.orders[0].deliveredAt);
  assert.equal(data.materials[0].stockMilli, 96000);
  await nav("Reports");
  await page.screenshot({
    path: "test-results/platform/reports-desktop.png",
    fullPage: true,
  });
  for (const [name, file] of [
    ["Export orders CSV", "orders.csv"],
    ["Export schedule CSV", "schedule.csv"],
    ["Download PDF report", "production.pdf"],
  ]) {
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name, exact: true }).click();
    await (await download).saveAs(`test-results/platform/${file}`);
  }
  assert.ok(
    (await fs.stat("test-results/platform/production.pdf")).size > 1000,
  );
  await nav("Notifications");
  await page
    .getByRole("button", { name: "Mark all as read", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mark all as read", exact: true }),
  ).toBeDisabled();
  await nav("Audit log");
  await expect(page.locator(".p-history-item").first()).toBeVisible();
  await page.locator(".p-history-item summary").first().click();
  await expect(page.locator(".p-history-item pre").first()).toBeVisible();
  const mobile = await browser.newContext({
      storageState: account.state,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
    phone = await mobile.newPage();
  await phone.goto(`${base}/app?unit=${unit}`);
  await expect(
    phone.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  assert.equal(
    await phone.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await phone.screenshot({
    path: "test-results/platform/overview-mobile.png",
    fullPage: true,
  });
  await phone
    .getByRole("navigation")
    .getByRole("button", { name: "Orders", exact: true })
    .tap();
  await phone.getByRole("button", { name: "Create order", exact: true }).tap();
  await expect(phone.getByRole("dialog")).toBeVisible();
  await phone.screenshot({
    path: "test-results/platform/order-mobile.png",
    fullPage: true,
  });
  await phone.getByRole("button", { name: "Cancel", exact: true }).tap();
  await mobile.close();
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "test-results/platform/flow-summary.json",
    JSON.stringify({
      unit,
      orders: data.orders.length,
      revision: data.tenant.revision,
      passed: true,
    }),
  );
  console.log(
    "Desktop production flow, date rescheduling, stock issue, progress/hold/resume, two-stage completion, delivery, notifications, audit, exports and phone form passed.",
  );
} catch (e) {
  await page.screenshot({
    path: "test-results/platform/flow-failure.png",
    fullPage: true,
  });
  console.log(
    "Visible page:",
    (await page.locator("body").innerText()).slice(-6000),
  );
  throw e;
} finally {
  await context.close();
  await browser.close();
}
