import type { Data } from "../src/production/actions";
export function actionFixture(): Data {
  const materialId = crypto.randomUUID(),
    productId = crypto.randomUUID(),
    machines = [0, 1].map((i) => ({
      id: crypto.randomUUID(),
      name: `Machine ${i + 1}`,
      code: `MC-${i + 1}`,
      kind: "Production",
      dailyCapacityMinutes: 480,
      shifts: [1, 2, 3, 4, 5].map((weekday) => ({
        weekday,
        startMinute: 480,
        endMinute: 1020,
      })),
      downtime: [],
    }));
  const routing = machines.map((m, i) => ({
    id: crypto.randomUUID(),
    name: i === 0 ? "Cutting" : "Finishing",
    machineId: m.id,
    minutesPerUnit: 10,
    setupMinutes: i === 0 ? 20 : 0,
  }));
  const bom = [{ materialId, quantityMilliPerUnit: 1000 }];
  return {
    tenant: {
      id: crypto.randomUUID(),
      name: "Test plant",
      timeZone: "UTC",
      horizonDays: 14,
      dispatchBufferDays: 1,
      revision: 0,
      createdAt: "2026-09-07T08:00:00Z",
    },
    machines,
    materials: [
      {
        id: materialId,
        name: "Steel",
        code: "STEEL",
        unit: "kg",
        stockMilli: 1000000000,
        reorderMilli: 5000,
        leadTimeDays: 3,
      },
    ],
    products: [{ id: productId, sku: "P-1", name: "Bracket", bom, routing }],
    orders: [
      {
        id: crypto.randomUUID(),
        number: "ORD-1",
        customer: "Customer",
        productId,
        productName: "Bracket",
        quantity: 10,
        priority: "normal",
        deadline: "2026-09-10",
        bom,
        stages: routing.map((s, sequence) => ({
          ...s,
          id: crypto.randomUUID(),
          sequence,
          status: "queued",
          completedQuantity: 0,
          startedAt: null,
          completedAt: null,
          holdReason: null,
          setupCompleted: s.setupMinutes === 0,
          workSessions: [],
        })),
        materialsIssued: false,
        createdAt: "2026-09-07T08:00:00Z",
        completedAt: null,
        deliveredAt: null,
        cancelledAt: null,
      },
    ],
    receipts: [],
    plan: null,
  };
}
