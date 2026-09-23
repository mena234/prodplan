import { describe, it, expect } from "vitest";
import {
  generatePlan,
  validatePlan,
  moveSegment,
  evaluatePlan,
} from "../src/production/scheduler";
import { applyMutation, type Data } from "../src/production/actions";
import { actionFixture } from "./production-fixture";
import { parseCsv, csvText } from "../src/production/csv";
import { analytics } from "../src/production/analytics";
import { mutationSchema, productSchema } from "../src/production/validation";
import { can } from "../src/production/permissions";
const now = new Date("2026-09-07T08:00:00Z");
function fixture() {
  const data = actionFixture();
  data.plan = generatePlan(data, "priority", now);
  return data;
}
const mutate = (
  data: Data,
  action: Parameters<typeof applyMutation>[1],
  time = now,
) => applyMutation(data, action, "tester", time);
describe("production planning", () => {
  it("schedules sequential stages within capacity and leaves no overlaps", () => {
    const data = fixture();
    expect(validatePlan(data, data.plan!)).toEqual([]);
    const [first, last] = data.plan!.allocations;
    expect(first.startMinute + first.minutes).toBeLessThanOrEqual(
      last.startMinute,
    );
    expect(data.plan!.orders[0].finish).toBe("2026-09-07");
  });
  it("respects shifts, planned downtime and day capacity caps", () => {
    const data = actionFixture();
    data.machines[0].downtime = [
      {
        id: crypto.randomUUID(),
        date: "2026-09-07",
        startMinute: 480,
        endMinute: 540,
        reason: "Maintenance",
      },
    ];
    data.machines[0].dailyCapacityMinutes = 120;
    const plan = generatePlan(data, "priority", now);
    expect(plan.allocations[0].startMinute).toBe(540);
    expect(validatePlan(data, plan)).toEqual([]);
  });
  it("does not overbook the same stock across competing orders", () => {
    const data = actionFixture();
    data.materials[0].stockMilli = 10000;
    data.orders.push({
      ...structuredClone(data.orders[0]),
      id: crypto.randomUUID(),
      number: "ORD-2",
      stages: data.orders[0].stages.map((s) => ({
        ...s,
        id: crypto.randomUUID(),
      })),
    });
    const plan = generatePlan(data, "priority", now);
    expect(plan.orders.filter((o) => o.status === "blocked")).toHaveLength(1);
    expect(validatePlan(data, plan)).toEqual([]);
  });
  it("uses expected arrivals for forecasts but excludes overdue unreceived receipts", () => {
    const data = actionFixture();
    data.materials[0].stockMilli = 0;
    data.receipts = [
      {
        id: crypto.randomUUID(),
        materialId: data.materials[0].id,
        quantityMilli: 10000,
        expectedDate: "2026-09-08",
        reference: "PO",
        status: "expected",
        receivedAt: null,
      },
    ];
    const plan = generatePlan(data, "priority", now);
    expect(plan.orders[0].start).toBe("2026-09-08");
    expect(plan.risks[0].message).toContain("has not been received");
    data.receipts[0].expectedDate = "2026-09-06";
    expect(generatePlan(data, "priority", now).orders[0].status).toBe(
      "blocked",
    );
  });
  it("detects capacity overflow and never reports a partial route as fully planned", () => {
    const data = actionFixture();
    data.orders[0].quantity = 100000;
    const plan = generatePlan(data, "priority", now);
    expect(plan.orders[0].finish).toBeNull();
    expect(plan.risks.some((r) => r.code === "capacity")).toBe(true);
    expect(validatePlan(data, plan)).toEqual([]);
  });
  it("rejects duplicate allocation IDs and excess work on one stage", () => {
    const data = fixture();
    const plan = structuredClone(data.plan!);
    plan.allocations[1].id = plan.allocations[0].id;
    expect(validatePlan(data, plan)).toContain(
      "Production segments must have unique identifiers.",
    );
    const bad = [{ ...plan.allocations[0], minutes: 240 }];
    const evaluated = evaluatePlan(data, bad, [], "priority", now);
    expect(evaluated.orders[0].finish).toBeNull();
    expect(
      validatePlan(data, evaluated).some((m) => m.includes("more time")),
    ).toBe(true);
  });
  it("moves a later stage to the first free window after its predecessor", () => {
    const data = fixture();
    let plan = moveSegment(
      data,
      data.plan!,
      data.plan!.allocations[1].id,
      "2026-09-08",
      true,
      now,
    );
    plan = moveSegment(
      data,
      plan,
      plan.allocations.find((a) => a.stageId === data.orders[0].stages[1].id)!
        .id,
      "2026-09-07",
      true,
      now,
    );
    expect(
      plan.allocations.find((a) => a.stageId === data.orders[0].stages[1].id)!
        .startMinute,
    ).toBe(600);
    expect(validatePlan(data, plan)).toEqual([]);
  });
  it("rejects moving production into a closed day", () => {
    const data = fixture();
    expect(() =>
      moveSegment(
        data,
        data.plan!,
        data.plan!.allocations[0].id,
        "2026-09-12",
        true,
        now,
      ),
    ).toThrow();
  });
  it("saves an exact minute through the plan move action", () => {
    const data = fixture();
    const stage = data.orders[0].stages[1];
    const result = mutate(data, {
      action: "plan.move",
      allocationId: data.plan!.allocations[1].id,
      date: "2026-09-07",
      startMinute: 637,
      locked: true,
    });
    expect(
      result.data.plan!.allocations.find((a) => a.stageId === stage.id)
        ?.startMinute,
    ).toBe(637);
    const regenerated = generatePlan(
      { ...result.data, previousPlan: result.data.plan },
      "priority",
      now,
    );
    expect(
      regenerated.allocations.find((a) => a.stageId === stage.id)?.startMinute,
    ).toBe(637);
  });
  it("rejects an exact time before its predecessor without shifting it silently", () => {
    const data = fixture();
    expect(() =>
      moveSegment(
        data,
        data.plan!,
        data.plan!.allocations[1].id,
        "2026-09-07",
        true,
        now,
        590,
      ),
    ).toThrow("start time cannot fit");
  });
  it("rejects exact times overlapping occupied capacity or downtime", () => {
    const data = fixture();
    const stage = data.plan!.allocations[1];
    data.machines[1].downtime.push({
      id: crypto.randomUUID(),
      date: "2026-09-08",
      startMinute: 600,
      endMinute: 660,
      reason: "Maintenance",
    });
    expect(() =>
      moveSegment(data, data.plan!, stage.id, "2026-09-08", true, now, 615),
    ).toThrow("start time cannot fit");
    const other = {
      ...stage,
      id: "occupied",
      orderId: "other",
      date: "2026-09-08",
      startMinute: 700,
    };
    expect(() =>
      moveSegment(
        data,
        { ...data.plan!, allocations: [...data.plan!.allocations, other] },
        stage.id,
        "2026-09-08",
        true,
        now,
        700,
      ),
    ).toThrow("start time cannot fit");
  });
  it("allows midnight but rejects times that extend beyond the shift or use invalid minutes", () => {
    const data = fixture();
    data.machines.forEach((m) => {
      m.dailyCapacityMinutes = 1440;
      m.shifts = [{ weekday: 2, startMinute: 0, endMinute: 1440 }];
    });
    const last = data.plan!.allocations[1];
    // The first stage is complete, so the next day may begin at midnight.
    data.orders[0].stages[0].status = "completed";
    data.orders[0].stages[0].completedAt = now.toISOString();
    data.plan!.allocations = [last];
    const moved = moveSegment(
      data,
      data.plan!,
      last.id,
      "2026-09-08",
      true,
      now,
      0,
    );
    expect(moved.allocations[0].startMinute).toBe(0);
    expect(() =>
      moveSegment(data, data.plan!, last.id, "2026-09-08", true, now, 1430),
    ).toThrow("start time cannot fit");
    for (const minute of [-1, 1440, 600.5])
      expect(() =>
        moveSegment(data, data.plan!, last.id, "2026-09-08", true, now, minute),
      ).toThrow("valid start time");
  });
  it("clears a stale predecessor warning after moving the affected stage later", () => {
    const data = fixture();
    const result = mutate(
      data,
      {
        action: "plan.move",
        allocationId: data.plan!.allocations[1].id,
        date: "2026-09-08",
        locked: true,
      },
      new Date("2026-09-07T08:05:00Z"),
    );
    expect(result.data.plan!.risks).toEqual([]);
    expect(result.data.plan!.orders[0].status).toBe("scheduled");
    expect(
      validatePlan(
        result.data,
        result.data.plan!,
        new Date("2026-09-07T08:05:00Z"),
      ),
    ).toEqual([]);
  });
  it("rebases remaining started work without allocating productive time in the past", () => {
    let data = fixture();
    data = mutate(data, {
      action: "stage.update",
      orderId: data.orders[0].id,
      stageId: data.orders[0].stages[0].id,
      transition: "start",
    }).data;
    const later = new Date("2026-09-07T08:30:00Z"),
      plan = generatePlan(
        { ...data, previousPlan: data.plan },
        "priority",
        later,
      );
    expect(
      plan.allocations.every(
        (a) => a.date > "2026-09-07" || a.startMinute >= 510,
      ),
    ).toBe(true);
    expect(
      plan.allocations
        .filter((a) => a.stageId === data.orders[0].stages[0].id)
        .reduce((n, a) => n + a.minutes, 0),
    ).toBe(120);
    expect(validatePlan(data, plan, later)).toEqual([]);
  });
  it("allows unlocking an expired segment while recalculating the plan", () => {
    const data = fixture();
    data.plan!.allocations[0].locked = true;
    const result = mutate(
      data,
      {
        action: "plan.lock",
        allocationId: data.plan!.allocations[0].id,
        locked: false,
      },
      new Date("2026-09-07T08:01:00Z"),
    );
    expect(validatePlan(result.data, result.data.plan!)).toEqual([]);
  });
  it("preserves customer/priority/deadline edits and explicit stage locks", () => {
    for (const field of ["customer", "priority", "deadline"]) {
      const data = fixture();
      data.plan = moveSegment(
        data,
        data.plan!,
        data.plan!.allocations[1].id,
        "2026-09-08",
        true,
        now,
      );
      const o = data.orders[0],
        value = {
          id: o.id,
          number: o.number,
          customer: o.customer,
          productId: o.productId,
          quantity: o.quantity,
          priority: o.priority,
          deadline: o.deadline,
          ...{
            [field]:
              field === "customer"
                ? "New customer"
                : field === "priority"
                  ? "high"
                  : "2026-09-10",
          },
        };
      const result = mutate(data, {
        action: "order.save",
        value: value as never,
      }).data;
      expect(result.orders[0].stages.map((s) => s.id)).toEqual(
        o.stages.map((s) => s.id),
      );
      expect(
        result.plan!.allocations.some(
          (a) => a.locked && a.date === "2026-09-08",
        ),
      ).toBe(true);
    }
  });
  it("updates overdue delivery risks when time passes without changing records", () => {
    const data = fixture();
    data.orders[0].deadline = "2026-09-07";
    const next = evaluatePlan(
      data,
      data.plan!.allocations,
      [],
      "priority",
      new Date("2026-09-08T08:00:00Z"),
    );
    expect(next.orders[0].status).toBe("delayed");
    expect(next.risks.some((r) => r.message.includes("still unfinished"))).toBe(
      true,
    );
  });
});
describe("floor and stock operations", () => {
  it("issues material only once through start, hold and resume", () => {
    let data = fixture();
    const orderId = data.orders[0].id,
      stageId = data.orders[0].stages[0].id,
      opening = data.materials[0].stockMilli;
    let result = mutate(data, {
      action: "stage.update",
      orderId,
      stageId,
      transition: "start",
    });
    expect(result.movements).toHaveLength(1);
    data = result.data;
    expect(data.materials[0].stockMilli).toBe(opening - 10000);
    data = mutate(
      data,
      {
        action: "stage.update",
        orderId,
        stageId,
        transition: "hold",
        reason: "Machine fault",
      },
      new Date("2026-09-07T08:10:00Z"),
    ).data;
    result = mutate(
      data,
      { action: "stage.update", orderId, stageId, transition: "resume" },
      new Date("2026-09-07T08:30:00Z"),
    );
    expect(result.movements).toHaveLength(0);
    expect(result.data.materials[0].stockMilli).toBe(opening - 10000);
    expect(result.data.orders[0].stages[0].workSessions).toHaveLength(2);
    expect(result.data.plan!.allocations[0].startMinute).toBe(510);
  });
  it("blocks starting a successor and starting before actual stock receipt", () => {
    const data = fixture();
    expect(() =>
      mutate(data, {
        action: "stage.update",
        orderId: data.orders[0].id,
        stageId: data.orders[0].stages[1].id,
        transition: "start",
      }),
    ).toThrow("preceding stage");
    data.materials[0].stockMilli = 0;
    expect(() =>
      mutate(data, {
        action: "stage.update",
        orderId: data.orders[0].id,
        stageId: data.orders[0].stages[0].id,
        transition: "start",
      }),
    ).toThrow("not been received");
  });
  it("records a hold despite a downstream lock, and releases dependent work", () => {
    let data = fixture();
    const orderId = data.orders[0].id,
      stageId = data.orders[0].stages[0].id;
    data = mutate(data, {
      action: "stage.update",
      orderId,
      stageId,
      transition: "start",
    }).data;
    data.plan!.allocations.find(
      (a) => a.stageId === data.orders[0].stages[1].id,
    )!.locked = true;
    const result = mutate(data, {
      action: "stage.update",
      orderId,
      stageId,
      transition: "hold",
      reason: "Fault",
    });
    expect(result.data.orders[0].stages[0].status).toBe("on_hold");
    expect(result.data.plan!.allocations).toHaveLength(0);
    expect(result.data.orders[0].stages[0].workSessions[0].endedAt).toBe(
      now.toISOString(),
    );
  });
  it("resuming actual work displaces queued locks on that machine", () => {
    let data = fixture();
    const orderId = data.orders[0].id,
      stageId = data.orders[0].stages[0].id;
    data = mutate(data, {
      action: "stage.update",
      orderId,
      stageId,
      transition: "start",
    }).data;
    data = mutate(data, {
      action: "stage.update",
      orderId,
      stageId,
      transition: "hold",
      reason: "Fault",
    }).data;
    const other = structuredClone(actionFixture().orders[0]);
    other.id = crypto.randomUUID();
    other.number = "ORD-2";
    other.productId = data.products[0].id;
    other.bom = structuredClone(data.orders[0].bom);
    other.stages = other.stages.map((s, i) => ({
      ...s,
      id: crypto.randomUUID(),
      machineId: data.machines[i].id,
    }));
    data.orders.push(other);
    data.plan = generatePlan(data, "priority", now);
    data.plan.allocations.forEach((a) => (a.locked = true));
    const result = mutate(
      data,
      { action: "stage.update", orderId, stageId, transition: "resume" },
      new Date("2026-09-07T08:30:00Z"),
    );
    expect(
      result.data.plan!.allocations.find((a) => a.stageId === stageId)!
        .startMinute,
    ).toBe(510);
    expect(validatePlan(result.data, result.data.plan!)).toEqual([]);
  });
  it("tracks progress without repeating setup and rejects quantity regression", () => {
    let data = fixture();
    const orderId = data.orders[0].id,
      stageId = data.orders[0].stages[0].id;
    data = mutate(data, {
      action: "stage.update",
      orderId,
      stageId,
      transition: "start",
    }).data;
    data = mutate(data, {
      action: "stage.update",
      orderId,
      stageId,
      transition: "progress",
      completedQuantity: 5,
      setupCompleted: true,
    }).data;
    expect(
      data
        .plan!.allocations.filter((a) => a.stageId === stageId)
        .reduce((n, a) => n + a.minutes, 0),
    ).toBe(50);
    expect(() =>
      mutate(data, {
        action: "stage.update",
        orderId,
        stageId,
        transition: "progress",
        completedQuantity: 4,
      }),
    ).toThrow("Progress must increase");
  });
  it("receives a purchase once and keeps inventory ledger quantities exact", () => {
    let data = fixture();
    const id = crypto.randomUUID();
    data.receipts = [
      {
        id,
        materialId: data.materials[0].id,
        quantityMilli: 1250,
        expectedDate: "2026-09-07",
        reference: "PO",
        status: "expected",
        receivedAt: null,
      },
    ];
    const opening = data.materials[0].stockMilli;
    const result = mutate(data, { action: "receipt.receive", receiptId: id });
    data = result.data;
    expect(data.materials[0].stockMilli).toBe(opening + 1250);
    expect(result.movements[0].deltaMilli).toBe(1250);
    expect(() =>
      mutate(data, { action: "receipt.receive", receiptId: id }),
    ).toThrow("already");
  });
  it("requires explicit completion before delivery and never cancels started work", () => {
    let data = fixture();
    const orderId = data.orders[0].id,
      stageId = data.orders[0].stages[0].id;
    expect(() => mutate(data, { action: "order.deliver", orderId })).toThrow(
      "Complete production",
    );
    data = mutate(data, {
      action: "stage.update",
      orderId,
      stageId,
      transition: "start",
    }).data;
    expect(() => mutate(data, { action: "order.cancel", orderId })).toThrow(
      "Started production",
    );
  });
  it("preserves the input if a mutation is rejected", () => {
    const data = fixture(),
      before = JSON.stringify(data);
    expect(() =>
      mutate(data, {
        action: "inventory.adjust",
        materialId: crypto.randomUUID(),
        stockMilli: 0,
        reason: "Test",
      }),
    ).toThrow();
    expect(JSON.stringify(data)).toBe(before);
  });
});
describe("validation, roles and reporting", () => {
  it("enforces the role matrix without relying on UI visibility", () => {
    expect(can("viewer", "orders")).toBe(false);
    expect(can("supervisor", "floor")).toBe(true);
    expect(can("supervisor", "plan")).toBe(false);
    expect(can("planner", "members")).toBe(false);
    expect(can("admin", "audit")).toBe(true);
  });
  it("rejects fractional order quantities and duplicate BOM lines", () => {
    const data = fixture();
    expect(
      mutationSchema.safeParse({
        action: "order.save",
        tenantId: data.tenant.id,
        revision: 0,
        key: crypto.randomUUID(),
        value: {
          number: "A",
          customer: "B",
          productId: data.products[0].id,
          quantity: 1.5,
          priority: "normal",
          deadline: "2026-09-10",
        },
      }).success,
    ).toBe(false);
    expect(
      productSchema.safeParse({
        ...data.products[0],
        bom: [data.products[0].bom[0], data.products[0].bom[0]],
      }).success,
    ).toBe(false);
  });
  it("handles quoted CSV fields and rejects malformed quoted data", () => {
    expect(parseCsv('a,b\r\n"A, B","He said ""yes"""')).toEqual([
      ["a", "b"],
      ["A, B", 'He said "yes"'],
    ]);
    expect(() => parseCsv('a,"open')).toThrow("unclosed");
    expect(csvText([["=1+1", "normal"]])).toContain("'=1+1");
  });
  it("calculates actual on-time deliveries and excludes hold time", () => {
    const data = fixture(),
      o = data.orders[0];
    o.completedAt = "2026-09-07T10:00:00Z";
    o.deliveredAt = "2026-09-08T10:00:00Z";
    o.deadline = "2026-09-08";
    o.stages[0].workSessions = [
      { startedAt: "2026-09-07T08:00:00Z", endedAt: "2026-09-07T08:30:00Z" },
      { startedAt: "2026-09-07T09:30:00Z", endedAt: "2026-09-07T10:00:00Z" },
    ];
    const result = analytics(data, new Date("2026-09-09T08:00:00Z"));
    expect(result.onTimePercent).toBe(100);
    expect(result.throughput).toBe(10);
    expect(result.productiveMinutes).toBe(60);
  });
});
