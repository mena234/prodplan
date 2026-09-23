import { z } from "zod";
const id = z.string().uuid();
const name = z.string().trim().min(1).max(120);
const code = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(
    /^[\p{L}\p{N}._ -]+$/u,
    "Use letters, numbers, spaces, dots, hyphens or underscores.",
  );
const amount = z.number().int().min(0).max(1_000_000_000_000);
const positive = amount.min(1);
const day = z.iso.date();
export const roleSchema = z.enum(["admin", "planner", "supervisor", "viewer"]);
export const settingsSchema = z.object({
  name,
  timeZone: z
    .string()
    .max(80)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid time zone."),
  horizonDays: z.number().int().min(7).max(90),
  dispatchBufferDays: z.number().int().min(0).max(14),
});
const shiftSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine(
    (s) => s.endMinute > s.startMinute,
    "A shift must finish after it starts.",
  );
const downtimeSchema = z
  .object({
    id,
    date: day,
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    reason: name,
  })
  .refine(
    (d) => d.endMinute > d.startMinute,
    "Downtime must finish after it starts.",
  );
export const machineSchema = z
  .object({
    id: id.optional(),
    name,
    code,
    kind: name,
    dailyCapacityMinutes: z.number().int().min(1).max(1440),
    shifts: z.array(shiftSchema).min(1).max(28),
    downtime: z.array(downtimeSchema).max(365),
  })
  .superRefine((machine, ctx) => {
    const shifts = [...machine.shifts].sort(
      (a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute,
    );
    for (let i = 1; i < shifts.length; i++)
      if (
        shifts[i].weekday === shifts[i - 1].weekday &&
        shifts[i].startMinute < shifts[i - 1].endMinute
      )
        ctx.addIssue({
          code: "custom",
          path: ["shifts"],
          message: "Shifts on the same day cannot overlap.",
        });
  });
export const materialSchema = z.object({
  id: id.optional(),
  name,
  code,
  unit: z.enum(["kg", "pcs", "m", "l"]),
  stockMilli: amount,
  reorderMilli: amount,
  leadTimeDays: z.number().int().min(0).max(730),
});
export const productSchema = z
  .object({
    id: id.optional(),
    name,
    sku: code,
    bom: z
      .array(
        z.object({
          materialId: id,
          quantityMilliPerUnit: positive.max(1_000_000_000),
        }),
      )
      .min(1)
      .max(50),
    routing: z
      .array(
        z.object({
          id,
          name,
          machineId: id,
          minutesPerUnit: z.number().int().min(1).max(10080),
          setupMinutes: z.number().int().min(0).max(10080),
        }),
      )
      .min(1)
      .max(20),
  })
  .superRefine((product, ctx) => {
    if (
      new Set(product.bom.map((line) => line.materialId)).size !==
      product.bom.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["bom"],
        message: "Include each material only once in the BOM.",
      });
    if (
      new Set(product.routing.map((stage) => stage.id)).size !==
      product.routing.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["routing"],
        message: "Routing stages must have unique identifiers.",
      });
  });
export const orderSchema = z.object({
  id: id.optional(),
  number: code,
  customer: name,
  productId: id,
  quantity: z.number().int().min(1).max(100000),
  priority: z.enum(["urgent", "high", "normal", "low"]),
  deadline: day,
});
export const receiptSchema = z.object({
  id: id.optional(),
  materialId: id,
  quantityMilli: positive,
  expectedDate: day,
  reference: name,
});
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("machine.save"), value: machineSchema }),
  z.object({ action: z.literal("material.save"), value: materialSchema }),
  z.object({ action: z.literal("product.save"), value: productSchema }),
  z.object({ action: z.literal("order.save"), value: orderSchema }),
  z.object({
    action: z.literal("order.import"),
    rows: z
      .array(orderSchema.omit({ id: true }))
      .min(1)
      .max(200),
  }),
  z.object({ action: z.literal("order.cancel"), orderId: id }),
  z.object({ action: z.literal("order.deliver"), orderId: id }),
  z.object({
    action: z.literal("record.delete"),
    kind: z.enum(["machine", "material", "product"]),
    id,
  }),
  z.object({
    action: z.literal("inventory.adjust"),
    materialId: id,
    stockMilli: amount,
    reason: name,
  }),
  z.object({ action: z.literal("receipt.save"), value: receiptSchema }),
  z.object({ action: z.literal("receipt.receive"), receiptId: id }),
  z.object({ action: z.literal("receipt.cancel"), receiptId: id }),
  z.object({
    action: z.literal("stage.update"),
    orderId: id,
    stageId: id,
    transition: z.enum(["start", "hold", "resume", "complete", "progress"]),
    completedQuantity: z.number().int().min(0).max(100000).optional(),
    setupCompleted: z.boolean().optional(),
    reason: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("plan.generate"),
    strategy: z
      .enum(["priority", "deadline", "shortest", "material"])
      .default("priority"),
  }),
  z.object({
    action: z.literal("plan.move"),
    allocationId: z.string().min(1).max(200),
    date: day,
    startMinute: z.number().int().min(0).max(1439).optional(),
    locked: z.boolean(),
  }),
  z.object({
    action: z.literal("plan.lock"),
    allocationId: z.string().min(1).max(200),
    locked: z.boolean(),
  }),
  z.object({ action: z.literal("settings.save"), value: settingsSchema }),
]);
export const mutationSchema = z
  .object({ tenantId: id, revision: z.number().int().min(0), key: id })
  .and(action);
export type Mutation = z.infer<typeof mutationSchema>;
export type Action = z.infer<typeof action>;
