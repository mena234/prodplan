import type { Machine } from "../domain/types";
import { workingWindows } from "../scheduling/constraints";
import { localDay, localMinute } from "./dates";
import { generatePlan, moveSegment, validatePlan } from "./scheduler";
import type { Action } from "./validation";
import type {
  InventoryMovement,
  Material,
  ProductionOrder,
  Product,
  Receipt,
  Workspace,
} from "./types";
import type { Permission } from "./permissions";

export type Data = Pick<
  Workspace,
  | "tenant"
  | "machines"
  | "materials"
  | "products"
  | "orders"
  | "receipts"
  | "plan"
>;
export class DomainError extends Error {}
function fail(message: string): never {
  throw new DomainError(message);
}
const find = <T extends { id: string }>(
  records: T[],
  id: string,
  label: string,
): T =>
  records.find((record) => record.id === id) ??
  fail(`${label} does not exist in this workspace.`);
function save<T extends { id: string }>(records: T[], record: T) {
  const index = records.findIndex((item) => item.id === record.id);
  if (index < 0) records.push(record);
  else records[index] = record;
}
function unique(
  records: Array<{ id: string }>,
  id: string,
  getCode: (record: { id: string }) => string,
  code: string,
) {
  if (
    records.some(
      (record) =>
        record.id !== id &&
        getCode(record).toLowerCase() === code.toLowerCase(),
    )
  )
    fail("That reference is already in use. Choose a unique reference.");
}
export function permissionFor(action: Action): Permission {
  if (action.action.startsWith("stage.")) return "floor";
  if (action.action.startsWith("plan.")) return "plan";
  if (action.action.startsWith("order.")) return "orders";
  if (
    action.action.startsWith("receipt.") ||
    action.action.startsWith("inventory.")
  )
    return "inventory";
  if (action.action.startsWith("settings.")) return "settings";
  return "masters";
}
export function applyMutation(
  current: Data,
  action: Action,
  actorId: string,
  now = new Date(),
) {
  const data = structuredClone(current),
    timestamp = now.toISOString();
  const movements: InventoryMovement[] = [];
  let targetId: string | null = null,
    before: unknown = null,
    after: unknown = null;
  const movement = (
    materialId: string,
    deltaMilli: number,
    type: InventoryMovement["type"],
    reason: string,
    orderId: string | null = null,
    receiptId: string | null = null,
  ) => {
    movements.push({
      id: crypto.randomUUID(),
      materialId,
      deltaMilli,
      type,
      reason,
      orderId,
      receiptId,
      actorId,
      createdAt: timestamp,
    });
  };
  const newOrder = (
    value: Extract<Action, { action: "order.save" }>["value"],
  ) => {
    const existing = value.id
      ? find(data.orders, value.id, "Order")
      : undefined;
    if (
      existing &&
      (existing.materialsIssued ||
        existing.cancelledAt ||
        existing.stages.some((stage) => stage.status !== "queued"))
    )
      fail("Only an unstarted, active order can be edited.");
    const product = find(data.products, value.productId, "Product"),
      id = value.id ?? crypto.randomUUID();
    unique(
      data.orders,
      id,
      (record) => (record as ProductionOrder).number,
      value.number,
    );
    const preserveRoute =
      existing &&
      existing.productId === value.productId &&
      existing.quantity === value.quantity;
    const result: ProductionOrder = {
      ...value,
      id,
      productName: preserveRoute ? existing.productName : product.name,
      bom: structuredClone(preserveRoute ? existing.bom : product.bom),
      stages: product.routing.map((step, sequence) => ({
        ...step,
        id: crypto.randomUUID(),
        sequence,
        status: "queued",
        completedQuantity: 0,
        startedAt: null,
        completedAt: null,
        holdReason: null,
        setupCompleted: step.setupMinutes === 0,
        workSessions: [],
      })),
      materialsIssued: false,
      createdAt: existing?.createdAt ?? timestamp,
      completedAt: null,
      deliveredAt: null,
      cancelledAt: null,
    };
    if (preserveRoute) result.stages = structuredClone(existing.stages);
    save(data.orders, result);
    return result;
  };
  switch (action.action) {
    case "machine.save": {
      const id = action.value.id ?? crypto.randomUUID();
      before = action.value.id ? find(data.machines, id, "Work center") : null;
      unique(
        data.machines,
        id,
        (record) => (record as Machine).code,
        action.value.code,
      );
      const value = { ...action.value, id };
      save(data.machines, value);
      targetId = id;
      after = value;
      break;
    }
    case "material.save": {
      const id = action.value.id ?? crypto.randomUUID();
      const existing = action.value.id
        ? find(data.materials, id, "Material")
        : null;
      if (existing && existing.unit !== action.value.unit)
        fail(
          "A material’s unit cannot change. Create a new material for a different unit.",
        );
      if (existing && existing.stockMilli !== action.value.stockMilli)
        fail("Use Stock adjustment to change on-hand inventory.");
      unique(
        data.materials,
        id,
        (record) => (record as Material).code,
        action.value.code,
      );
      const value = { ...action.value, id };
      save(data.materials, value);
      if (!existing && value.stockMilli)
        movement(id, value.stockMilli, "opening", "Opening inventory");
      before = existing;
      after = value;
      targetId = id;
      break;
    }
    case "product.save": {
      for (const line of action.value.bom)
        find(data.materials, line.materialId, "BOM material");
      for (const stage of action.value.routing)
        find(data.machines, stage.machineId, "Routing work center");
      const id = action.value.id ?? crypto.randomUUID();
      before = action.value.id ? find(data.products, id, "Product") : null;
      unique(
        data.products,
        id,
        (record) => (record as Product).sku,
        action.value.sku,
      );
      const value = { ...action.value, id };
      save(data.products, value);
      after = value;
      targetId = id;
      break;
    }
    case "record.delete": {
      targetId = action.id;
      if (action.kind === "machine") {
        before = find(data.machines, action.id, "Work center");
        if (
          data.products.some((p) =>
            p.routing.some((s) => s.machineId === action.id),
          ) ||
          data.orders.some((o) =>
            o.stages.some((s) => s.machineId === action.id),
          )
        )
          fail(
            "This work center is referenced by a product or production order.",
          );
        data.machines = data.machines.filter(
          (record) => record.id !== action.id,
        );
      } else if (action.kind === "material") {
        before = find(data.materials, action.id, "Material");
        if (
          data.products.some((p) =>
            p.bom.some((line) => line.materialId === action.id),
          ) ||
          data.orders.some((o) =>
            o.bom.some((line) => line.materialId === action.id),
          ) ||
          data.receipts.some((receipt) => receipt.materialId === action.id) ||
          (before as Material).stockMilli !== 0
        )
          fail(
            "This material has stock or is referenced by a product, order or receipt.",
          );
        data.materials = data.materials.filter(
          (record) => record.id !== action.id,
        );
      } else {
        before = find(data.products, action.id, "Product");
        if (data.orders.some((order) => order.productId === action.id))
          fail(
            "This product is referenced by an order and must be kept for its history.",
          );
        data.products = data.products.filter(
          (record) => record.id !== action.id,
        );
      }
      break;
    }
    case "order.save": {
      before = action.value.id
        ? find(current.orders, action.value.id, "Order")
        : null;
      after = newOrder(action.value);
      targetId = (after as ProductionOrder).id;
      break;
    }
    case "order.import": {
      const created = action.rows.map(newOrder);
      after = created;
      break;
    }
    case "order.cancel": {
      const order = find(data.orders, action.orderId, "Order");
      before = structuredClone(order);
      if (
        order.materialsIssued ||
        order.stages.some((stage) => stage.status !== "queued")
      )
        fail(
          "Started production cannot be cancelled. Put the active stage on hold for a supervisor review.",
        );
      if (order.cancelledAt) fail("This order is already cancelled.");
      order.cancelledAt = timestamp;
      targetId = order.id;
      after = order;
      break;
    }
    case "order.deliver": {
      const order = find(data.orders, action.orderId, "Order");
      before = structuredClone(order);
      if (!order.completedAt)
        fail("Complete production before confirming delivery.");
      if (order.deliveredAt) fail("Delivery is already confirmed.");
      order.deliveredAt = timestamp;
      after = order;
      targetId = order.id;
      break;
    }
    case "inventory.adjust": {
      const material = find(data.materials, action.materialId, "Material");
      before = structuredClone(material);
      const delta = action.stockMilli - material.stockMilli;
      if (!delta) fail("The quantity is unchanged.");
      material.stockMilli = action.stockMilli;
      movement(material.id, delta, "adjustment", action.reason);
      after = material;
      targetId = material.id;
      break;
    }
    case "receipt.save": {
      find(data.materials, action.value.materialId, "Material");
      const existing = action.value.id
        ? find(data.receipts, action.value.id, "Receipt")
        : null;
      if (existing && existing.status !== "expected")
        fail("Only an expected receipt can be edited.");
      const receipt: Receipt = {
        ...action.value,
        id: action.value.id ?? crypto.randomUUID(),
        status: "expected",
        receivedAt: null,
      };
      save(data.receipts, receipt);
      before = existing;
      after = receipt;
      targetId = receipt.id;
      break;
    }
    case "receipt.receive":
    case "receipt.cancel": {
      const receipt = find(data.receipts, action.receiptId, "Receipt");
      before = structuredClone(receipt);
      if (receipt.status !== "expected")
        fail("This receipt has already been received or cancelled.");
      if (action.action === "receipt.receive") {
        const material = find(data.materials, receipt.materialId, "Material");
        if (material.stockMilli + receipt.quantityMilli > 1_000_000_000_000)
          fail("This receipt exceeds the inventory limit.");
        material.stockMilli += receipt.quantityMilli;
        receipt.status = "received";
        receipt.receivedAt = timestamp;
        movement(
          material.id,
          receipt.quantityMilli,
          "receipt",
          receipt.reference,
          null,
          receipt.id,
        );
      } else receipt.status = "cancelled";
      after = receipt;
      targetId = receipt.id;
      break;
    }
    case "stage.update": {
      const order = find(data.orders, action.orderId, "Order"),
        stage = find(order.stages, action.stageId, "Production stage");
      before = structuredClone(order);
      targetId = order.id;
      if (order.cancelledAt || order.completedAt)
        fail("This order is no longer active.");
      const earlier = order.stages.filter(
        (item) => item.sequence < stage.sequence,
      );
      const start = action.transition === "start",
        resume = action.transition === "resume";
      if (start || resume) {
        if (
          (start && stage.status !== "queued") ||
          (resume && stage.status !== "on_hold")
        )
          fail("This stage cannot make that transition.");
        if (earlier.some((item) => item.status !== "completed"))
          fail("Complete every preceding stage first.");
        const running = data.orders.some(
          (other) =>
            !other.cancelledAt &&
            other.stages.some(
              (item) =>
                item.id !== stage.id &&
                item.machineId === stage.machineId &&
                item.status === "in_progress",
            ),
        );
        if (running)
          fail(
            "Another stage is running on this work center. Finish or hold it first.",
          );
        const machine = find(data.machines, stage.machineId, "Work center"),
          minute = localMinute(data.tenant.timeZone, now),
          day = localDay(data.tenant.timeZone, now);
        if (
          !workingWindows(machine, day).some(
            (window) => minute >= window.start && minute < window.end,
          )
        )
          fail(
            "This work center is outside its available shift or in planned downtime.",
          );
        if (
          start &&
          !data.plan?.allocations.some(
            (job) =>
              job.orderId === order.id &&
              job.stageId === stage.id &&
              job.date === day &&
              job.startMinute <= minute &&
              job.startMinute + job.minutes > minute,
          )
        )
          fail(
            "This stage is not in its scheduled production window. Ask the planner to recalculate or move it before starting.",
          );
        if (!order.materialsIssued) {
          for (const line of order.bom) {
            const material = find(data.materials, line.materialId, "Material"),
              required = line.quantityMilliPerUnit * order.quantity;
            if (material.stockMilli < required)
              fail(
                `${material.name} has not been received in sufficient quantity. Expected receipts cannot be issued as actual stock.`,
              );
          }
          for (const line of order.bom) {
            const material = find(data.materials, line.materialId, "Material"),
              required = line.quantityMilliPerUnit * order.quantity;
            material.stockMilli -= required;
            movement(
              material.id,
              -required,
              "production",
              `Material issued to ${order.number}`,
              order.id,
            );
          }
          order.materialsIssued = true;
        }
        stage.status = "in_progress";
        stage.startedAt ??= timestamp;
        stage.holdReason = null;
        stage.workSessions.push({ startedAt: timestamp, endedAt: null });
      } else {
        if (stage.status !== "in_progress")
          fail("Only a running stage can be held, updated or completed.");
        if (action.transition === "hold") {
          if (!action.reason?.trim())
            fail("Enter a reason for putting production on hold.");
          stage.status = "on_hold";
          stage.holdReason = action.reason;
        } else if (action.transition === "progress") {
          if (
            action.completedQuantity === undefined ||
            action.completedQuantity < stage.completedQuantity ||
            action.completedQuantity >= order.quantity
          )
            fail(
              "Progress must increase or stay unchanged and be less than the order quantity. Use Complete for finished work.",
            );
          stage.completedQuantity = action.completedQuantity;
          if (action.completedQuantity > 0 || action.setupCompleted)
            stage.setupCompleted = true;
        } else if (action.transition === "complete") {
          stage.status = "completed";
          stage.completedQuantity = order.quantity;
          stage.setupCompleted = true;
          stage.completedAt = timestamp;
          if (order.stages.every((item) => item.status === "completed"))
            order.completedAt = timestamp;
        }
        if (action.transition !== "progress") {
          const session = stage.workSessions.findLast(
            (item) => item.endedAt === null,
          );
          if (session) session.endedAt = timestamp;
        }
      }
      // Actual floor events take precedence over future queued commitments.
      // Release dependent locks so a hold or machine restart can always be recorded.
      const released: string[] = [];
      const affectedOrders = new Set([order.id]);
      if (start || resume)
        for (const job of data.plan?.allocations ?? [])
          if (job.machineId === stage.machineId)
            affectedOrders.add(job.orderId);
      if (data.plan)
        for (const job of data.plan.allocations) {
          const jobStage = data.orders
            .find((item) => item.id === job.orderId)
            ?.stages.find((item) => item.id === job.stageId);
          if (
            job.locked &&
            jobStage?.status === "queued" &&
            affectedOrders.has(job.orderId)
          ) {
            job.locked = false;
            released.push(job.id);
          }
        }
      after = { order, releasedSegments: released };
      break;
    }
    case "settings.save":
      before = structuredClone(data.tenant);
      Object.assign(data.tenant, action.value);
      after = data.tenant;
      targetId = data.tenant.id;
      break;
    case "plan.generate":
      break;
    case "plan.move": {
      if (!data.plan) fail("Generate a schedule before moving work.");
      before = data.plan;
      const original = find(
        data.plan.allocations,
        action.allocationId,
        "Segment",
      );
      const movingPlan = {
        ...data.plan,
        allocations: data.plan.allocations.map((job) =>
          job.id === original.id ? { ...job, locked: true } : job,
        ),
      };
      const refreshed = generatePlan(
        { ...data, previousPlan: movingPlan },
        data.plan.strategy,
        now,
      );
      const target =
        refreshed.allocations.find((job) => job.id === original.id) ??
        refreshed.allocations
          .filter(
            (job) =>
              job.orderId === original.orderId &&
              job.stageId === original.stageId &&
              job.date === original.date &&
              job.minutes === original.minutes,
          )
          .sort(
            (a, b) =>
              Math.abs(a.startMinute - original.startMinute) -
              Math.abs(b.startMinute - original.startMinute),
          )[0];
      if (!target)
        fail(
          "This segment changed as time advanced. Recalculate and review the current plan before moving it.",
        );
      data.plan = refreshed;
      data.plan = moveSegment(
        { ...data, previousPlan: data.plan },
        data.plan,
        target.id,
        action.date,
        action.locked,
        now,
        action.startMinute,
      );
      after = data.plan;
      targetId = action.allocationId;
      break;
    }
    case "plan.lock": {
      if (!data.plan) fail("Generate a schedule first.");
      const allocation = find(
        data.plan.allocations,
        action.allocationId,
        "Segment",
      );
      const stage = find(
        find(data.orders, allocation.orderId, "Order").stages,
        allocation.stageId,
        "Stage",
      );
      if (stage.status !== "queued") fail("Started work remains locked.");
      before = structuredClone(allocation);
      allocation.locked = action.locked;
      after = allocation;
      targetId = allocation.id;
      break;
    }
  }
  if (
    !action.action.startsWith("plan.") ||
    action.action === "plan.generate" ||
    action.action === "plan.lock"
  ) {
    const strategy =
      action.action === "plan.generate"
        ? action.strategy
        : (data.plan?.strategy ?? "priority");
    data.plan = generatePlan(
      { ...data, previousPlan: data.plan },
      strategy,
      now,
    );
    if (action.action === "plan.generate") {
      before = current.plan;
      after = data.plan;
    }
  }
  if (data.plan) {
    const violations = validatePlan(data, data.plan, now);
    if (violations.length)
      fail(violations[0] + " Resolve or unlock affected work before saving.");
  }
  return { data, movements, targetId, before, after };
}
