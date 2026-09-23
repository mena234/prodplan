import { applyMutation, type Data } from "./actions";
import { generatePlan } from "./scheduler";
import { addDays, localDay } from "./dates";
import type { Product } from "./types";

export function demoSeed(
  tenantId: string,
  actorId: string,
  timeZone = "UTC",
  now = new Date(),
): Data {
  const today = localDay(timeZone, now);
  let data: Data = {
    tenant: {
      id: tenantId,
      name: "Northstar sample plant",
      timeZone,
      horizonDays: 14,
      dispatchBufferDays: 1,
      revision: 0,
      createdAt: now.toISOString(),
    },
    machines: [],
    materials: [],
    products: [],
    orders: [],
    receipts: [],
    plan: null,
  };
  // Continuous coverage by three shifts keeps the real floor controls usable
  // at any visitor's local time without bypassing production shift rules.
  const shifts = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
    { weekday, startMinute: 0, endMinute: 480 },
    { weekday, startMinute: 480, endMinute: 960 },
    { weekday, startMinute: 960, endMinute: 1440 },
  ]);
  for (const [code, name, kind] of [
    ["CUT-01", "Laser cutting", "Cutting"],
    ["FIN-01", "Finishing line", "Finishing"],
    ["ASM-01", "Assembly bench", "Assembly"],
  ])
    data.machines.push({
      id: crypto.randomUUID(),
      code,
      name,
      kind,
      dailyCapacityMinutes: 1440,
      shifts: structuredClone(shifts),
      downtime:
        code === "CUT-01"
          ? [
              {
                id: crypto.randomUUID(),
                date: addDays(today, 1),
                startMinute: 600,
                endMinute: 660,
                reason: "Lens inspection",
              },
            ]
          : [],
    });
  for (const [code, name, stockMilli, reorderMilli] of [
    ["STEEL", "Sheet steel", 500000, 80000],
    ["ALU", "Aluminium sheet", 6000, 20000],
    ["FIX", "Fastener kit", 250000, 30000],
  ] as const)
    data.materials.push({
      id: crypto.randomUUID(),
      code,
      name,
      stockMilli,
      reorderMilli,
      unit: code === "FIX" ? "pcs" : "kg",
      leadTimeDays: code === "ALU" ? 4 : 2,
    });
  const product = (
    sku: string,
    name: string,
    material: number,
    amount: number,
    stages: Array<[string, number, number, number]>,
  ): Product => ({
    id: crypto.randomUUID(),
    sku,
    name,
    bom: [
      { materialId: data.materials[material].id, quantityMilliPerUnit: amount },
    ],
    routing: stages.map(([name, machine, minutesPerUnit, setupMinutes]) => ({
      id: crypto.randomUUID(),
      name,
      machineId: data.machines[machine].id,
      minutesPerUnit,
      setupMinutes,
    })),
  });
  data.products.push(
    product("BRACKET", "Steel bracket", 0, 2000, [
      ["Cutting", 0, 10, 20],
      ["Finishing", 1, 10, 0],
    ]),
    product("HOUSING", "Aluminium housing", 1, 3000, [
      ["Cutting", 0, 15, 30],
      ["Assembly", 2, 20, 10],
    ]),
    product("FRAME", "Machine frame", 0, 5000, [
      ["Cutting", 0, 40, 30],
      ["Assembly", 2, 60, 30],
    ]),
  );
  for (const [number, customer, productIndex, quantity, priority, deadline] of [
    ["DEMO-001", "Atlas Engineering", 0, 4, "urgent", 4],
    ["DEMO-002", "Riverside Components", 0, 18, "normal", 7],
    ["DEMO-003", "Apex Instruments", 1, 12, "high", 2],
    ["DEMO-004", "Meridian Automation", 2, 30, "high", 0],
  ] as const)
    data = applyMutation(
      data,
      {
        action: "order.save",
        value: {
          number,
          customer,
          productId: data.products[productIndex].id,
          quantity,
          priority,
          deadline: addDays(today, deadline),
        },
      },
      actorId,
      now,
    ).data;
  data.receipts.push({
    id: crypto.randomUUID(),
    materialId: data.materials[1].id,
    quantityMilli: 20000,
    expectedDate: addDays(today, 4),
    reference: "PO-ALU-204 · partial delivery",
    status: "expected",
    receivedAt: null,
  });
  data.plan = generatePlan(data, "priority", now);
  return data;
}
