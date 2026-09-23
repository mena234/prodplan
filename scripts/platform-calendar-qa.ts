import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import type { Workspace, Allocation } from "../src/production/types";
import type { Action } from "../src/production/validation";

const base = "http://127.0.0.1:3018";
const account = JSON.parse(
  await fs.readFile("test-results/platform/account.json", "utf8"),
);
const { unit } = JSON.parse(
  await fs.readFile("test-results/platform/flow-summary.json", "utf8"),
);
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const context = await browser.newContext({
  storageState: account.state,
  viewport: { width: 1440, height: 1000 },
  extraHTTPHeaders: { Origin: base },
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const add = (day: string, n: number) =>
  new Date(Date.parse(day + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
async function snapshot(): Promise<Workspace> {
  return (
    await context.request.get(`${base}/api/platform/workspace?tenantId=${unit}`)
  ).json();
}
async function mutate(action: Action) {
  const data = await snapshot();
  const r = await context.request.post(`${base}/api/platform/workspace`, {
    data: {
      ...action,
      tenantId: unit,
      revision: data.tenant.revision,
      key: crypto.randomUUID(),
    },
  });
  assert.equal(r.status(), 200, await r.text());
  return r.json() as Promise<Workspace>;
}
const post = () =>
  page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/platform/workspace") &&
      r.request().method() === "POST",
  );
const task = (job: Allocation) =>
  page.locator(`[data-allocation-id="${job.id}"]`);
async function submit(status = 200) {
  const pending = post();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  const r = await pending;
  assert.equal(r.status(), status, await r.text());
  if (status === 200) await expect(page.getByRole("dialog")).toHaveCount(0);
  else
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Save", exact: true }),
    ).toBeEnabled();
}
async function edit(
  job: Allocation,
  date: string,
  minute: number,
  status = 200,
) {
  await task(job).locator(".p-segment-info").focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Production date").fill(date);
  await page
    .getByLabel("Start time hours", { exact: true })
    .selectOption(String(Math.floor(minute / 60)));
  await page
    .getByLabel("Start time minutes", { exact: true })
    .selectOption(String(minute % 60));
  await submit(status);
}
async function drag(job: Allocation, dx: number, dy = 0, status?: number) {
  await task(job).scrollIntoViewIfNeeded();
  const b = (await task(job).locator(".p-segment-info").boundingBox())!;
  const pending = status ? post() : null;
  await page.mouse.move(b.x + 50, b.y + 25);
  await page.mouse.down();
  await page.mouse.move(b.x + 50 + dx, b.y + 25 + dy, { steps: 12 });
  await page.mouse.up();
  if (pending) {
    const r = await pending;
    assert.equal(r.status(), status, await r.text());
  }
}
async function nav() {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Planning board", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Production schedule" }),
  ).toBeVisible();
}
try {
  let data = await snapshot();
  for (const order of data.orders.filter(
    (o) => o.customer === "Row calendar QA" && !o.cancelledAt,
  )) {
    data = await mutate({ action: "order.cancel", orderId: order.id });
  }
  const today = new Date().toISOString().slice(0, 10),
    targetDate = add(today, 2);
  const prefix = `ROW-${Date.now()}`;
  const jobs: Allocation[] = [];
  for (let i = 0; i < 3; i++) {
    data = await mutate({
      action: "order.save",
      value: {
        number: `${prefix}-${i}`,
        customer: "Row calendar QA",
        productId: data.products[0].id,
        quantity: i === 2 ? 1 : 4,
        priority: "normal",
        deadline: add(today, 8),
      },
    });
    const order = data.orders.find((o) => o.number === `${prefix}-${i}`)!;
    const last = data.plan!.allocations.find(
      (a) => a.stageId === order.stages.at(-1)!.id,
    )!;
    data = await mutate({
      action: "plan.move",
      allocationId: last.id,
      date: targetDate,
      startMinute: [575, 660, 840][i],
      locked: true,
    });
    const first = data.plan!.allocations.find(
      (a) => a.stageId === order.stages[0].id,
    )!;
    data = await mutate({
      action: "plan.move",
      allocationId: first.id,
      date: add(today, 1),
      startMinute: 480 + i * 120,
      locked: true,
    });
    jobs.push(data.plan!.allocations.find((a) => a.id === last.id)!);
  }
  let job = jobs[0];
  const machine = data.machines.find((m) => m.id === job.machineId)!;
  data = await mutate({
    action: "machine.save",
    value: {
      ...machine,
      downtime: [
        {
          id: crypto.randomUUID(),
          date: targetDate,
          startMinute: 630,
          endMinute: 660,
          reason: "Row calendar maintenance",
        },
      ],
    },
  });
  await page.goto(`${base}/app?unit=${unit}`);
  await nav();
  await expect(
    page.getByRole("button", { name: "Day", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".p-board-row")).toHaveCount(data.machines.length);
  await page.getByLabel("Calendar date").fill(targetDate);
  await expect(page.locator(".p-time-ruler > span")).toHaveCount(24);
  const row = page.locator(`[data-work-center="${job.machineId}"]`);
  await expect(row.locator(".p-machine-label")).toContainText(machine.name);
  await expect(row.locator(".p-segment")).toHaveCount(3);
  await edit(job, targetDate, 577);
  assert.equal(
    (await snapshot()).plan!.allocations.find((a) => a.id === job.id)!
      .startMinute,
    577,
  );
  await page.reload();
  await nav();
  await page.getByLabel("Calendar date").fill(targetDate);
  await expect(task(job).locator(".p-segment-info")).toHaveAccessibleName(
    /09:37 to 10:17/,
  );
  await page.getByLabel("Drag step").selectOption("1");
  const beforeZoom = await page
    .locator(".p-board-scroll")
    .evaluate((e) => e.scrollLeft);
  await page.getByLabel("Timeline zoom").selectOption("15");
  await expect(page.locator(".p-time-ruler > span")).toHaveCount(96);
  await expect
    .poll(() => page.locator(".p-board-scroll").evaluate((e) => e.scrollLeft))
    .toBeCloseTo(beforeZoom * 4, 0);
  await drag(job, 6.4, 0, 200);
  await expect(task(job).locator(".p-segment-info")).toHaveAccessibleName(
    /09:38 to 10:18/,
  );
  await page.getByLabel("Timeline zoom").selectOption("hours");
  await expect(page.locator(".p-time-ruler > span")).toHaveCount(24);
  const viewport = (await page.locator(".p-board-scroll").boundingBox())!;
  const label = (await row.locator(".p-machine-label").boundingBox())!;
  assert.ok(
    Math.abs(label.x - viewport.x - 1) < 2,
    "Machine label must stay pinned while scrolling",
  );
  assert.ok(
    Math.abs(
      (await task(job).locator(".p-segment-duration").boundingBox())!.width -
        job.minutes * 1.6,
    ) < 1,
  );
  assert.ok(
    (await task(jobs[2]).boundingBox())!.width >= 160,
    "Short task label remains readable",
  );
  await page.screenshot({
    path: "test-results/platform/row-calendar-day.png",
    fullPage: true,
  });
  const revision = (await snapshot()).tenant.revision;
  await edit(job, targetDate, 620, 400);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "cannot fit",
  );
  await expect(
    page.getByLabel("Start time minutes", { exact: true }),
  ).toHaveValue("20");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  assert.equal((await snapshot()).tenant.revision, revision);
  await task(job).scrollIntoViewIfNeeded();
  const current = (await task(job).locator(".p-segment-info").boundingBox())!;
  const other = (await page
    .locator(`.p-board-row:not([data-work-center="${job.machineId}"])`)
    .first()
    .boundingBox())!;
  await drag(job, 0, other.y + 50 - (current.y + 25));
  await expect(page.getByRole("alert")).toContainText(
    "current work-center row",
  );
  assert.equal((await snapshot()).tenant.revision, revision);
  const b = (await task(job).locator(".p-segment-info").boundingBox())!;
  await page.mouse.move(b.x + 50, b.y + 25);
  await page.mouse.down();
  await page.mouse.move(b.x + 90, b.y + 25);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal((await snapshot()).tenant.revision, revision);
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.locator(".p-board-row")).toHaveCount(data.machines.length);
  await expect(page.locator(".p-time-day")).toHaveCount(7);
  await drag(job, 360, 0, 200);
  job = (await snapshot()).plan!.allocations.find((a) => a.id === job.id)!;
  assert.equal(job.date, add(targetDate, 1));
  assert.equal(job.startMinute, 578);
  await edit(job, targetDate, 1380);
  await drag(job, 22.5, 0, 200);
  job = (await snapshot()).plan!.allocations.find((a) => a.id === job.id)!;
  assert.equal(job.date, add(targetDate, 1));
  assert.equal(job.startMinute, 30);
  await edit(job, job.date, 0);
  const pending = post();
  await page.getByRole("button", { name: "Recalculate", exact: true }).click();
  assert.equal((await pending).status(), 200);
  job = (await snapshot()).plan!.allocations.find((a) => a.id === job.id)!;
  assert.equal(job.startMinute, 0);
  assert.ok(job.locked);
  await page.getByLabel("Work center filter").selectOption(machine.id);
  await expect(page.locator(".p-board-row")).toHaveCount(1);
  await page.screenshot({
    path: "test-results/platform/row-calendar-week.png",
    fullPage: true,
  });
  // Put the test task at a practical hour for the real touch interaction.
  await edit(job, job.date, 575);
  const tablet = await browser.newContext({
    storageState: account.state,
    viewport: { width: 1180, height: 900 },
    isMobile: true,
    hasTouch: true,
  });
  const tp = await tablet.newPage();
  await tp.goto(`${base}/app?unit=${unit}`);
  await tp
    .getByRole("navigation")
    .getByRole("button", { name: "Planning board", exact: true })
    .tap();
  await tp.getByLabel("Calendar date").fill(job.date);
  await tp.getByLabel("Drag step").selectOption("1");
  const te = tp.locator(`[data-allocation-id="${job.id}"] .p-segment-info`);
  await te.scrollIntoViewIfNeeded();
  const tb = (await te.boundingBox())!;
  const cdp = await tablet.newCDPSession(tp);
  const touchSaved = tp.waitForResponse(
    (r) =>
      r.url().endsWith("/api/platform/workspace") &&
      r.request().method() === "POST",
  );
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: tb.x + 50, y: tb.y + 25 }],
  });
  for (let i = 1; i <= 10; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: tb.x + 50 + i * 4.8, y: tb.y + 25 }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.equal((await touchSaved).status(), 200);
  await expect(te).toHaveAccessibleName(/10:05 to 10:45/);
  await tp.screenshot({
    path: "test-results/platform/row-calendar-tablet.png",
    fullPage: true,
  });
  await tablet.close();
  const phoneContext = await browser.newContext({
    storageState: account.state,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await phoneContext.newPage();
  await phone.goto(`${base}/app?unit=${unit}`);
  await phone
    .getByRole("navigation")
    .getByRole("button", { name: "Planning board", exact: true })
    .tap();
  await phone.getByLabel("Calendar date").fill(job.date);
  await phone.getByLabel("Work center filter").selectOption(machine.id);
  await phone.locator(`[data-allocation-id="${job.id}"] .p-segment-info`).tap();
  await expect(phone.getByRole("dialog")).toContainText(
    `Work center: ${machine.name}`,
  );
  await expect(
    phone.getByLabel("Start time minutes", { exact: true }),
  ).toHaveValue("5");
  await phone
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .tap();
  assert.equal(
    await phone.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await phone.screenshot({
    path: "test-results/platform/row-calendar-phone.png",
    fullPage: true,
  });
  await phoneContext.close();
  assert.deepEqual(errors, []);
  await fs.writeFile(
    "test-results/platform/calendar-summary.json",
    JSON.stringify(
      {
        unit,
        prefix,
        passed: [
          "work-center rows in Day and Week",
          "exact-minute edit and reload",
          "one-minute whole-task drag",
          "zoom retains time",
          "pinned work-center names",
          "proportional duration bars",
          "downtime and wrong-row rejection",
          "Escape cancellation",
          "cross-day and cross-midnight moves",
          "midnight retained through recalculation",
          "resource filter",
          "tablet touch drag",
          "phone exact-time editor",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Row calendar QA passed", { unit, prefix });
} catch (e) {
  await page.screenshot({
    path: "test-results/platform/row-calendar-failure.png",
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
}
