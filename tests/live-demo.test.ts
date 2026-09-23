import { describe, it, expect } from "vitest";
import { demoSeed } from "../src/production/demo-seed";
import { generatePlan, validatePlan } from "../src/production/scheduler";
import { applyMutation } from "../src/production/actions";
import { validateDemoAction } from "../src/production/server/demo-limits";
import { demoToken } from "../src/production/server/demo-session";

describe("live demo uses production constraints", () => {
  it.each([
    "2026-09-09T09:00:00Z",
    "2027-01-02T23:58:00Z",
    "2027-03-14T01:30:00Z",
  ])("builds a current, valid sample plant at %s", (time) => {
    const now = new Date(time),
      data = demoSeed(
        crypto.randomUUID(),
        crypto.randomUUID(),
        "America/New_York",
        now,
      );
    expect(data.orders).toHaveLength(4);
    expect(validatePlan(data, data.plan!, now)).toEqual([]);
    expect(data.plan?.risks.some((r) => r.code === "material")).toBe(true);
    expect(data.plan?.risks.some((r) => r.code === "deadline")).toBe(true);
    const normal = data.plan!.orders.find(
      (o) => o.orderId === data.orders[0].id,
    )!;
    expect(normal.risks).toEqual([]);
    expect(normal.requiredMinutes).toBe(100);
  });
  it("creates isolated resources and supports the real order and floor actions", () => {
    const now = new Date("2026-09-09T09:00:00Z"),
      actor = crypto.randomUUID();
    let a = demoSeed(crypto.randomUUID(), actor, "UTC", now);
    const b = demoSeed(crypto.randomUUID(), crypto.randomUUID(), "UTC", now);
    expect(a.products[0].id).not.toBe(b.products[0].id);
    const order = a.orders[0],
      steel = a.materials[0].stockMilli;
    a = applyMutation(
      a,
      {
        action: "stage.update",
        orderId: order.id,
        stageId: order.stages[0].id,
        transition: "start",
      },
      actor,
      now,
    ).data;
    expect(a.materials[0].stockMilli).toBe(steel - 8000);
    expect(b.materials[0].stockMilli).toBe(steel);
    expect(a.orders[0].stages[0].status).toBe("in_progress");
    const plan = generatePlan(a, "deadline", now);
    expect(validatePlan(a, plan, now)).toEqual([]);
  });
  it("rejects large workloads before running scheduling", () => {
    const data = demoSeed(crypto.randomUUID(), crypto.randomUUID());
    const value = {
      number: "TRY-1",
      customer: "Test",
      productId: data.products[0].id,
      quantity: 100000,
      priority: "normal" as const,
      deadline: data.plan!.endDate,
    };
    expect(() =>
      validateDemoAction(data, { action: "order.save", value }),
    ).toThrow("200 units");
    expect(() =>
      validateDemoAction(data, {
        action: "settings.save",
        value: { ...data.tenant, horizonDays: 90 },
      }),
    ).toThrow("14-day");
    expect(() =>
      validateDemoAction(data, {
        action: "order.import",
        rows: Array(11).fill({ ...value, quantity: 1 }),
      }),
    ).toThrow("10 demo orders");
    expect(() =>
      validateDemoAction(
        { ...data, orders: Array(40).fill(data.orders[0]) },
        { action: "order.save", value: { ...value, quantity: 1 } },
      ),
    ).toThrow("40 orders");
  });
  it("does not accept a UUID, malformed or ambiguous demo credential", () => {
    for (const cookie of [
      "",
      `prodplan-live-demo=${crypto.randomUUID()}`,
      "prodplan-live-demo=oops",
      `prodplan-live-demo=${"a".repeat(64)}; prodplan-live-demo=${"b".repeat(64)}`,
    ])
      expect(demoToken(new Headers({ cookie }))).toBeNull();
    expect(
      demoToken(
        new Headers({ cookie: `prodplan-live-demo=${"a".repeat(64)}` }),
      ),
    ).toHaveLength(64);
  });
});
