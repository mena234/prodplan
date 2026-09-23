import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  chromium,
  expect as baseExpect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import type { Workspace } from "../src/production/types";

// Coverage: visitor introduction; first visit, resume, skip, restart and finish;
// real screen navigation; role-aware guidance; setup prerequisites and progress;
// keyboard focus/Escape; mobile fit; storage failure; no production mutations.
const expect = baseExpect.configure({ timeout: 20000 });
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
const errors: string[] = [];
const mutations: string[] = [];
const contexts: BrowserContext[] = [];
async function context(auth = true, mobile = false) {
  const ctx = await browser.newContext({
    ...(auth ? { storageState: account.state } : {}),
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
  p.setDefaultTimeout(10000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/api/"))
      mutations.push(r.method() + " " + r.url());
  });
  return p;
}
const tour = (p: Page) => p.locator("dialog.product-tour");
async function next(p: Page) {
  await tour(p)
    .getByRole("button", { name: /^(Next|Show me around)$/ })
    .click();
}
async function fits(p: Page) {
  const b = (await p.locator(".tour-card").boundingBox())!;
  const v = p.viewportSize()!;
  assert(
    b.x >= 0 &&
      b.y >= 0 &&
      b.x + b.width <= v.width + 1 &&
      b.y + b.height <= v.height + 1,
    "Tour fits in the viewport",
  );
  const footer = (await p.locator(".tour-footer").boundingBox())!;
  assert(footer.y + footer.height <= v.height, "Tour actions remain visible");
  assert(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "No page-level horizontal overflow",
  );
}
try {
  const ctx = await context();
  const p = await page(ctx);
  await p.goto(`${base}/app?unit=${unit}`, { waitUntil: "networkidle" });
  await expect(tour(p)).toBeVisible();
  await expect(tour(p).getByRole("heading")).toHaveText(
    "A clear plan for your production team",
  );
  await fits(p);
  await p.screenshot({ path: "test-results/platform/tour-welcome.png" });
  await next(p);
  await expect(tour(p)).toContainText("Your role is Admin");
  await next(p);
  await expect(p.locator(".p-page-header h1")).toHaveText("Work centers");
  await p.reload({ waitUntil: "networkidle" });
  await expect(tour(p).getByRole("heading")).toHaveText(
    "1. Define where work happens",
  );
  await tour(p).getByRole("button", { name: "Previous tour step" }).click();
  await expect(p.locator(".p-page-header h1")).toHaveText("Overview");
  await next(p);
  for (const view of [
    "Materials & stock",
    "Products & BOM",
    "Orders",
    "Planning board",
  ]) {
    await next(p);
    await expect(p.locator(".p-page-header h1")).toHaveText(view);
    await fits(p);
  }
  await p.screenshot({ path: "test-results/platform/tour-planning.png" });
  await next(p);
  await expect(tour(p)).toContainText("Conflicts & delivery risks");
  await next(p);
  await expect(p.locator(".p-page-header h1")).toHaveText("Production floor");
  await next(p);
  await expect(p.locator(".p-page-header h1")).toHaveText("Reports");
  await next(p);
  await tour(p).getByRole("button", { name: "Go to overview" }).click();
  await expect(tour(p)).toHaveCount(0);
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  await expect(tour(p)).toHaveCount(0);
  await p.getByRole("button", { name: "Product tour", exact: true }).click();
  await p.keyboard.press("Tab");
  assert(
    await p.evaluate(
      () => !!document.activeElement?.closest("dialog.product-tour"),
    ),
    "Keyboard focus stays in the tour",
  );
  await p.keyboard.press("Escape");
  await expect(tour(p)).toHaveCount(0);
  await expect(
    p.getByRole("button", { name: "Product tour", exact: true }),
  ).toBeFocused();
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  await expect(tour(p)).toHaveCount(0);

  const snapshot: Workspace = await (
    await ctx.request.get(`${base}/api/platform/workspace?tenantId=${unit}`)
  ).json();
  for (const role of ["viewer", "supervisor"] as const) {
    const roleContext = await context();
    await roleContext.route("**/api/platform/workspace?*", (route) =>
      route.fulfill({ json: { ...snapshot, role } }),
    );
    const rolePage = await page(roleContext);
    await rolePage.goto(`${base}/app?unit=${unit}`, {
      waitUntil: "networkidle",
    });
    await expect(tour(rolePage)).toBeVisible();
    await next(rolePage);
    await expect(tour(rolePage)).toContainText(
      role === "viewer"
        ? "cannot change production data"
        : "record production progress",
    );
    for (let i = 0; i < 5; i++) await next(rolePage);
    await expect(tour(rolePage)).toContainText(
      "Your planner handles rescheduling",
    );
    await next(rolePage);
    await next(rolePage);
    await expect(tour(rolePage)).toContainText(
      role === "viewer"
        ? "Admins and floor supervisors"
        : "Start the first available stage",
    );
    await tour(rolePage)
      .getByRole("button", { name: "Skip tour", exact: true })
      .click();
    await expect(rolePage.locator(".p-onboarding")).toHaveCount(0);
    await roleContext.close();
  }

  const emptyContext = await context();
  let setup: Workspace = {
    ...snapshot,
    machines: [],
    materials: [],
    products: [],
    orders: [],
    receipts: [],
    notifications: [],
    plan: null,
    role: "admin",
  };
  await emptyContext.route("**/api/platform/workspace?*", (route) =>
    route.fulfill({ json: setup }),
  );
  const empty = await page(emptyContext);
  await empty.goto(`${base}/app?unit=${unit}`, { waitUntil: "networkidle" });
  await expect(tour(empty)).toBeVisible();
  // A tour must still complete when the calendar has no resources to highlight.
  for (let i = 0; i < 6; i++) await next(empty);
  await expect(tour(empty)).toContainText("Read the production schedule");
  await fits(empty);
  await tour(empty)
    .getByRole("button", { name: "Skip tour", exact: true })
    .click();
  await empty
    .getByRole("navigation")
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await expect(empty.locator(".p-onboarding")).toContainText("0 of 4 complete");
  await expect(
    empty.getByRole("button", { name: "Set up define a product" }),
  ).toBeDisabled();
  await empty
    .getByRole("button", { name: "Continue: add a work center" })
    .click();
  await expect(
    empty.getByRole("button", { name: "Add work center", exact: true }),
  ).toBeVisible();
  setup = { ...snapshot, orders: [] };
  await empty.reload({ waitUntil: "networkidle" });
  await expect(empty.locator(".p-onboarding")).toContainText("3 of 4 complete");
  await empty.screenshot({ path: "test-results/platform/tour-checklist.png" });
  await empty
    .getByRole("button", { name: "Continue: create your first order" })
    .click();
  await expect(
    empty.getByRole("button", { name: "Create order", exact: true }),
  ).toBeEnabled();
  setup = snapshot;
  await empty.reload({ waitUntil: "networkidle" });
  await expect(empty.locator(".p-onboarding")).toHaveCount(0);

  const phoneContext = await context(true, true);
  const phone = await page(phoneContext);
  await phone.goto(`${base}/app?unit=${unit}`, { waitUntil: "networkidle" });
  await expect(tour(phone)).toBeVisible();
  await fits(phone);
  for (let i = 0; i < 6; i++) {
    await next(phone);
    await fits(phone);
  }
  await phone.screenshot({ path: "test-results/platform/tour-phone.png" });
  await tour(phone).getByRole("button", { name: "Close product tour" }).tap();
  await expect(tour(phone)).toHaveCount(0);

  const guest = await page(await context(false));
  await guest.goto(`${base}/login`, { waitUntil: "networkidle" });
  await guest.getByRole("button", { name: "See how ProdPlan works" }).click();
  for (let i = 0; i < 4; i++) await next(guest);
  await tour(guest).getByRole("button", { name: "Create an account" }).click();
  await expect(
    guest.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();
  const demo = await page(await context(false, true));
  await demo.goto(base, { waitUntil: "networkidle" });
  await demo.getByRole("button", { name: "Try live demo", exact: true }).tap();
  await expect(tour(demo)).toBeVisible();
  await fits(demo);
  await expect(
    tour(demo).getByRole("button", { name: "Close product tour" }),
  ).toBeVisible();
  await demo.screenshot({ path: "test-results/platform/tour-demo-phone.png" });
  await tour(demo).getByRole("button", { name: "Close product tour" }).tap();
  await demo.reload({ waitUntil: "networkidle" });
  await demo.waitForTimeout(700);
  await expect(tour(demo)).toHaveCount(0);

  const blockedStorage = await context(false);
  await blockedStorage.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("Storage disabled");
    };
    Storage.prototype.setItem = () => {
      throw new Error("Storage disabled");
    };
  });
  const blocked = await page(blockedStorage);
  await blocked.goto(`${base}/login`, { waitUntil: "networkidle" });
  await blocked.getByRole("button", { name: "See how ProdPlan works" }).click();
  await next(blocked);
  await blocked.keyboard.press("Escape");
  await expect(tour(blocked)).toHaveCount(0);
  assert.deepEqual(
    mutations.filter((request) => !request.endsWith("/api/demo")),
    [],
    "Tour never writes production or account data",
  );
  assert.deepEqual(errors, [], "No browser errors");
  await fs.writeFile(
    "test-results/platform/tour-summary.json",
    JSON.stringify(
      {
        passed: [
          "public introduction and signup handoff",
          "first-visit welcome",
          "resume after reload",
          "back/next navigation",
          "skip, Escape, restart and completion",
          "keyboard focus and restoration",
          "all workspace screens",
          "viewer and supervisor guidance",
          "empty workspace and setup progress",
          "phone layout and touch controls",
          "unavailable browser storage",
          "no production writes",
        ],
        errors,
        mutations,
      },
      null,
      2,
    ),
  );
  console.log("Product tour QA passed");
} finally {
  await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  await browser.close();
}
