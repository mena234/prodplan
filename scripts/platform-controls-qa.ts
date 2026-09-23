import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import type { Workspace } from "../src/production/types";
const base = "http://127.0.0.1:3018",
  account = JSON.parse(
    await fs.readFile("test-results/platform/account.json", "utf8"),
  ),
  flow = JSON.parse(
    await fs.readFile("test-results/platform/flow-summary.json", "utf8"),
  ),
  unit = flow.unit;
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const context = await browser.newContext({
    storageState: account.state,
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { Origin: base },
  }),
  page = await context.newPage();
page.setDefaultTimeout(20000);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
async function snapshot(): Promise<Workspace> {
  return (
    await context.request.get(`${base}/api/platform/workspace?tenantId=${unit}`)
  ).json();
}
async function nav(name: string) {
  await page
    .getByRole("navigation")
    .getByRole("button")
    .filter({ hasText: name })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
async function save() {
  const waiting = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/platform/workspace") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  const response = await waiting;
  assert.equal(response.status(), 200, await response.text());
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
const prefix = `CTRL-${Date.now()}`,
  date = (day: string, n: number) =>
    new Date(Date.parse(day + "T00:00:00Z") + n * 86400000)
      .toISOString()
      .slice(0, 10);
try {
  await page.goto(`${base}/app?unit=${unit}&invite=${"f".repeat(64)}`);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("existing workspaces");
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("prodplan-invite")),
    null,
  );
  await nav("Orders");
  await page.getByRole("button", { name: "Create order", exact: true }).click();
  let d = page.getByRole("dialog");
  await d.getByLabel("Order reference").fill(prefix);
  await d.getByLabel("Customer").fill("Controls QA");
  await d
    .locator("select[name=product]")
    .selectOption({ label: "BRACKET · Steel bracket" });
  await d.locator("input[name=quantity]").fill("12");
  await save();
  let data = await snapshot();
  const order = data.orders.find((o) => o.number === prefix)!,
    stage = order.stages.at(-1)!,
    original = data.plan!.allocations.find((a) => a.stageId === stage.id)!;
  const movedDate = date(original.date, 2);
  await nav("Planning board");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  const handle = page.getByRole("button", {
    name: `Drag ${prefix} ${stage.name}`,
    exact: true,
  });
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  assert.ok(box);
  const target = page
    .locator(".p-board-row")
    .filter({
      has: page.getByRole("button", {
        name: `Drag ${prefix} ${stage.name}`,
        exact: true,
      }),
    })
    .locator(`[data-schedule-day="${movedDate}"]`);
  const targetBox = await target.boundingBox();
  assert.ok(targetBox);
  let response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/platform/workspace") &&
      r.request().method() === "POST",
  );
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + 80, box.y + box.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
  let res = await response;
  assert.equal(res.status(), 200, await res.text());
  await expect
    .poll(
      async () =>
        (await snapshot()).plan!.allocations.find((a) => a.stageId === stage.id)
          ?.date,
    )
    .toBe(movedDate);
  // Keyboard access opens the same validated date editor.
  await handle.focus();
  await page.keyboard.press("Enter");
  d = page.getByRole("dialog");
  await d.getByLabel("Production date").fill(date(original.date, 1));
  await save();
  const beforeCancel = (await snapshot()).tenant.revision;
  await handle.scrollIntoViewIfNeeded();
  let hb = await handle.boundingBox();
  assert.ok(hb);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 40, hb.y + hb.height / 2, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal((await snapshot()).tenant.revision, beforeCancel);
  // A real touch sequence on the tablet must persist a move as well.
  const tablet = await browser.newContext({
      storageState: account.state,
      viewport: { width: 1180, height: 900 },
      hasTouch: true,
      isMobile: true,
    }),
    touchPage = await tablet.newPage();
  await touchPage.goto(`${base}/app?unit=${unit}`);
  await touchPage
    .getByRole("navigation")
    .getByRole("button", { name: "Planning board", exact: true })
    .tap();
  const th = touchPage.getByRole("button", {
    name: `Drag ${prefix} ${stage.name}`,
    exact: true,
  });
  await touchPage.getByRole("button", { name: "Week", exact: true }).tap();
  await th.scrollIntoViewIfNeeded();
  hb = await th.boundingBox();
  assert.ok(hb);
  const cell = touchPage
      .locator(".p-board-row")
      .filter({ has: th })
      .locator(`[data-schedule-day="${movedDate}"]`),
    tb = await cell.boundingBox();
  assert.ok(tb);
  const cdp = await tablet.newCDPSession(touchPage);
  response = touchPage.waitForResponse(
    (r) =>
      r.url().endsWith("/api/platform/workspace") &&
      r.request().method() === "POST",
  );
  const sx = hb.x + hb.width / 2,
    sy = hb.y + hb.height / 2,
    tx = Math.min(tb.x + 60, 1140);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: sx, y: sy }],
  });
  for (let n = 1; n <= 16; n++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: sx + ((tx - sx) * n) / 16, y: sy }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  res = await response;
  assert.equal(res.status(), 200, await res.text());
  assert.equal(
    (await snapshot()).plan!.allocations.find((a) => a.stageId === stage.id)
      ?.date,
    movedDate,
  );
  await touchPage.screenshot({
    path: "test-results/platform/plan-tablet.png",
    fullPage: true,
  });
  await tablet.close();
  await page
    .getByRole("button", { name: "Refresh workspace", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/platform/plan-controls-desktop.png",
    fullPage: true,
  });
  // A stale dialog must preserve the draft, reject overwriting, and recover.
  await nav("Materials & stock");
  const materialRow = page
    .getByRole("row")
    .filter({ hasText: "STEEL" })
    .first();
  await materialRow.getByRole("button", { name: "Edit", exact: true }).click();
  d = page.getByRole("dialog");
  await d.locator("input[name=name]").fill("Unsaved local draft");
  data = await snapshot();
  const r = await context.request.post(`${base}/api/platform/workspace`, {
    data: {
      tenantId: unit,
      revision: data.tenant.revision,
      key: crypto.randomUUID(),
      action: "inventory.adjust",
      materialId: data.materials[0].id,
      stockMilli: data.materials[0].stockMilli + 1000,
      reason: "Concurrent stock check",
    },
  });
  assert.equal(r.status(), 200, await r.text());
  response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/platform/workspace") &&
      r.request().method() === "POST",
  );
  await d.getByRole("button", { name: "Save", exact: true }).click();
  assert.equal((await response).status(), 409);
  await expect(d.locator("input[name=name]")).toHaveValue(
    "Unsaved local draft",
  );
  await d
    .getByRole("button", {
      name: "Load latest values (discard this draft)",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog").locator("input[name=name]"),
  ).toHaveValue("Sheet steel");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Expected receipt", exact: true })
    .click();
  d = page.getByRole("dialog");
  await d.locator("input[name=reference]").fill(`${prefix}-PO`);
  await d.locator("input[name=quantity]").fill("2.5");
  await save();
  const receiptRow = page.getByRole("row").filter({ hasText: `${prefix}-PO` });
  await receiptRow
    .getByRole("button", { name: "Receive", exact: true })
    .click();
  await save();
  await expect(receiptRow).toContainText(/received/i);
  await nav("Orders");
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  d = page.getByRole("dialog");
  const csvHead = "number,customer,product_sku,quantity,priority,deadline\n",
    due = date(original.date, 6);
  await d.locator('input[type="file"]').setInputFiles({
    name: "invalid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      `${csvHead}${prefix}-CSV,Client,UNKNOWN,2,normal,${due}`,
    ),
  });
  await expect(d.getByRole("alert")).toContainText("SKU was not found");
  await d.locator('input[type="file"]').setInputFiles({
    name: "orders.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      `${csvHead}${prefix}-CSV,"Client, one",BRACKET,2,high,${due}\n${prefix}-CSV2,Client two,BRACKET,3,normal,${due}`,
    ),
  });
  await expect(d.getByText("2 orders ready to import.")).toBeVisible();
  await save();
  data = await snapshot();
  assert.ok(
    data.orders.some(
      (o) => o.number === `${prefix}-CSV` && o.customer === "Client, one",
    ),
  );
  await page
    .getByRole("button", { name: `${prefix}-CSV2`, exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel order", exact: true }).click();
  await save();
  assert.ok(
    (await snapshot()).orders.find((o) => o.number === `${prefix}-CSV2`)
      ?.cancelledAt,
  );
  await nav("Planning board");
  await page
    .getByRole("button", { name: "Compare schedules", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Schedule strategy"),
  ).toBeVisible();
  await save();
  await nav("Team");
  const fakeEmail = `controls-${Date.now()}@example.test`;
  await page
    .getByRole("button", { name: "Invite member", exact: true })
    .click();
  d = page.getByRole("dialog");
  await d.getByLabel("Email address").fill(fakeEmail);
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("row")
    .filter({ hasText: fakeEmail })
    .getByRole("button", { name: "Revoke", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page.getByRole("row").filter({ hasText: fakeEmail }),
  ).toContainText("Revoked");
  await page
    .getByRole("button", { name: "Workspace settings", exact: true })
    .click();
  d = page.getByRole("dialog");
  await d.locator("input[name=buffer]").fill("2");
  await save();
  assert.equal((await snapshot()).tenant.dispatchBufferDays, 2);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "test-results/platform/controls-summary.json",
    JSON.stringify({ passed: true, unit, prefix }),
  );
  console.log(
    "Mouse/touch/keyboard rescheduling, Escape cancellation, invalid invitation recovery, stale draft recovery, decimal receipts, CSV validation/import, cancellation, comparison, team revoke and settings passed.",
  );
} catch (e) {
  await page.screenshot({
    path: "test-results/platform/controls-failure.png",
    fullPage: true,
  });
  console.log((await page.locator("body").innerText()).slice(-4500));
  throw e;
} finally {
  await context.close();
  await browser.close();
}
