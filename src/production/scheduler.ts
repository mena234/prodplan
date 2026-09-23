import {
  daysBetween,
  freeWindows,
  priorityRank,
  workingWindows,
  subtract,
  type Window,
} from "../scheduling/constraints";
import {
  addDays,
  dayDifference,
  localDay,
  localMinute,
  quantity,
} from "./dates";
import type {
  Allocation,
  OrderPlan,
  Plan,
  PlanningInput,
  ProductionOrder,
  Risk,
  Stage,
} from "./types";

type Cursor = { date: string; minute: number };
type Supply = Map<string, Array<{ date: string; amount: number }>>;
const later = (a: Cursor, b: Cursor) =>
  a.date > b.date || (a.date === b.date && a.minute > b.minute) ? a : b;
const startOf = (a: Allocation): Cursor => ({
  date: a.date,
  minute: a.startMinute,
});
const endOf = (a: Allocation): Cursor => ({
  date: a.date,
  minute: a.startMinute + a.minutes,
});
const compareCursor = (a: Cursor, b: Cursor) =>
  a.date.localeCompare(b.date) || a.minute - b.minute;
const ordered = (a: Allocation, b: Allocation) =>
  compareCursor(startOf(a), startOf(b));
function demandLines(order: ProductionOrder) {
  const demand = new Map<string, number>();
  for (const line of order.bom)
    demand.set(
      line.materialId,
      (demand.get(line.materialId) ?? 0) + line.quantityMilliPerUnit,
    );
  return [...demand].map(([materialId, quantityMilliPerUnit]) => ({
    materialId,
    quantityMilliPerUnit,
  }));
}
export const stageMinutes = (order: ProductionOrder, stage: Stage) =>
  stage.status === "completed"
    ? 0
    : (order.quantity - stage.completedQuantity) * stage.minutesPerUnit +
      (stage.setupCompleted ? 0 : stage.setupMinutes);
export function orderMinutes(order: ProductionOrder) {
  return order.stages.reduce(
    (sum, stage) => sum + stageMinutes(order, stage),
    0,
  );
}
function supplies(input: PlanningInput, today: string): Supply {
  return new Map(
    input.materials.map((material) => [
      material.id,
      [
        { date: today, amount: material.stockMilli },
        ...input.receipts
          .filter(
            (receipt) =>
              receipt.materialId === material.id &&
              receipt.status === "expected" &&
              receipt.expectedDate >= today,
          )
          .map((receipt) => ({
            date: receipt.expectedDate,
            amount: receipt.quantityMilli,
          })),
      ].sort((a, b) => a.date.localeCompare(b.date)),
    ]),
  );
}
function materialReady(
  input: PlanningInput,
  order: ProductionOrder,
  supply: Supply,
  today: string,
) {
  let date = today;
  const risks: Risk[] = [];
  if (order.materialsIssued) return { date, risks };
  for (const line of demandLines(order)) {
    let needed = line.quantityMilliPerUnit * order.quantity;
    for (const bucket of supply.get(line.materialId) ?? []) {
      needed -= bucket.amount;
      if (needed <= 0) {
        if (bucket.date > date) date = bucket.date;
        break;
      }
    }
    if (needed > 0) {
      const material = input.materials.find((m) => m.id === line.materialId)!;
      const earliestDate = addDays(today, material?.leadTimeDays ?? 0);
      risks.push({
        id: `material:${order.id}:${line.materialId}`,
        orderId: order.id,
        code: "material",
        severity: "critical",
        materialId: line.materialId,
        shortageMilli: needed,
        earliestDate,
        message: `${quantity(needed, material?.unit ?? "units")} of ${material?.name ?? "a missing material"} is short after higher-priority reservations. Lead time suggests replenishment around ${earliestDate}; a confirmed receipt is required.`,
      });
    }
  }
  return { date, risks };
}
function reserve(order: ProductionOrder, supply: Supply) {
  if (order.materialsIssued) return;
  for (const line of demandLines(order)) {
    let needed = line.quantityMilliPerUnit * order.quantity;
    for (const bucket of supply.get(line.materialId) ?? []) {
      const used = Math.min(needed, bucket.amount);
      bucket.amount -= used;
      needed -= used;
      if (!needed) break;
    }
  }
}
export function sequenceOrders(
  input: PlanningInput,
  strategy: Plan["strategy"],
) {
  return [...input.orders].sort((a, b) => {
    const priority = priorityRank[a.priority] - priorityRank[b.priority];
    const due = a.deadline.localeCompare(b.deadline);
    if (strategy === "deadline" && due) return due;
    if (
      strategy === "shortest" &&
      priority === 0 &&
      orderMinutes(a) !== orderMinutes(b)
    )
      return orderMinutes(a) - orderMinutes(b);
    if (strategy === "material") {
      const shortage = (order: ProductionOrder) =>
        order.bom.reduce(
          (sum, line) =>
            sum +
            Math.max(
              0,
              line.quantityMilliPerUnit * order.quantity -
                (input.materials.find((m) => m.id === line.materialId)
                  ?.stockMilli ?? 0),
            ),
          0,
        );
      const delta = shortage(a) - shortage(b);
      if (delta) return delta;
    }
    return (
      priority ||
      due ||
      a.number.localeCompare(b.number) ||
      a.id.localeCompare(b.id)
    );
  });
}

export function generatePlan(
  input: PlanningInput,
  strategy: Plan["strategy"] = "priority",
  now = new Date(),
): Plan {
  const startDate = localDay(input.tenant.timeZone, now),
    endDate = addDays(startDate, input.tenant.horizonDays - 1);
  const nowCursor = {
    date: startDate,
    minute: localMinute(input.tenant.timeZone, now),
  };
  const allocations: Allocation[] = [],
    risks: Risk[] = [],
    supply = supplies(input, startDate);
  const orderMap = new Map(input.orders.map((order) => [order.id, order])),
    machineMap = new Map(
      input.machines.map((machine) => [machine.id, machine]),
    );
  const byStage = new Map<string, Allocation[]>(),
    byOrder = new Map<string, Allocation[]>(),
    byMachineDay = new Map<string, Allocation[]>(),
    windows = new Map<string, Window[]>();
  const stageKey = (orderId: string, stageId: string) =>
    `${orderId}:${stageId}`;
  const add = (job: Allocation) => {
    allocations.push(job);
    for (const [map, key] of [
      [byStage, stageKey(job.orderId, job.stageId)],
      [byOrder, job.orderId],
      [byMachineDay, `${job.machineId}:${job.date}`],
    ] as const) {
      const group = map.get(key);
      if (group) group.push(job);
      else map.set(key, [job]);
    }
  };
  const available = (
    machine: PlanningInput["machines"][number],
    date: string,
  ) => {
    const key = `${machine.id}:${date}`;
    let base = windows.get(key);
    if (!base) {
      base = workingWindows(machine, date);
      windows.set(key, base);
    }
    let result = base;
    for (const job of byMachineDay.get(key) ?? [])
      result = subtract(result, {
        start: job.startMinute,
        end: job.startMinute + job.minutes,
      });
    return result;
  };
  // Retain deliberate locks and started work inside the new horizon. Actual work
  // history is stored separately in stage work sessions and immutable plan versions.
  for (const old of input.previousPlan?.allocations ?? []) {
    const order = orderMap.get(old.orderId);
    const stage = order?.stages.find((s) => s.id === old.stageId);
    if (
      !order ||
      order.cancelledAt ||
      order.completedAt ||
      !stage ||
      stage.status === "completed" ||
      stage.status === "on_hold" ||
      old.date < startDate ||
      old.date > endDate
    )
      continue;
    if (old.locked || stage.status === "in_progress") {
      const retained = (byStage.get(stageKey(order.id, stage.id)) ?? []).reduce(
        (sum, a) => sum + a.minutes,
        0,
      );
      const startMinute = Math.max(
        old.startMinute,
        old.date === startDate ? nowCursor.minute : 0,
      );
      const minutes = Math.min(
        old.startMinute + old.minutes - startMinute,
        stageMinutes(order, stage) - retained,
      );
      if (minutes > 0) add({ ...old, startMinute, minutes, locked: true });
    }
  }
  // Material for locked and already started work is considered first.
  const orders = sequenceOrders(input, strategy).sort(
    (a, b) =>
      Number(b.stages.some((s) => s.status === "in_progress")) -
        Number(a.stages.some((s) => s.status === "in_progress")) ||
      Number(byOrder.has(b.id)) - Number(byOrder.has(a.id)),
  );
  for (const order of orders) {
    if (order.cancelledAt || order.completedAt) continue;
    const ready = materialReady(input, order, supply, startDate);
    if (ready.risks.length) {
      risks.push(...ready.risks);
      continue;
    }
    let cursor = later(nowCursor, { date: ready.date, minute: 0 });
    if (ready.date > startDate)
      risks.push({
        id: `supply:${order.id}`,
        orderId: order.id,
        code: "material",
        severity: "warning",
        earliestDate: ready.date,
        message: `Production depends on expected material arriving by ${ready.date}. Stock has not been received yet.`,
      });
    for (const stage of [...order.stages].sort(
      (a, b) => a.sequence - b.sequence,
    )) {
      if (stage.status === "completed") {
        if (stage.completedAt)
          cursor = later(cursor, {
            date: localDay(input.tenant.timeZone, new Date(stage.completedAt)),
            minute: localMinute(
              input.tenant.timeZone,
              new Date(stage.completedAt),
            ),
          });
        continue;
      }
      if (stage.status === "on_hold") {
        risks.push({
          id: `hold:${order.id}`,
          orderId: order.id,
          code: "hold",
          severity: "critical",
          message: `${stage.name} is on hold: ${stage.holdReason || "awaiting supervisor update"}. Later stages cannot start.`,
        });
        break;
      }
      const fixed = [...(byStage.get(stageKey(order.id, stage.id)) ?? [])].sort(
        ordered,
      );
      if (
        fixed.length &&
        compareCursor(startOf(fixed[0]), cursor) < 0 &&
        stage.status !== "in_progress"
      ) {
        risks.push({
          id: `locked:${stage.id}`,
          orderId: order.id,
          code: "capacity",
          severity: "critical",
          message: `The locked ${stage.name} segment precedes material or predecessor availability. Unlock or move it before releasing production.`,
        });
        break;
      }
      let remaining =
        stageMinutes(order, stage) -
        fixed.reduce((sum, a) => sum + a.minutes, 0);
      if (fixed.length) cursor = later(cursor, endOf(fixed.at(-1)!));
      const machine = machineMap.get(stage.machineId);
      if (!machine)
        throw new Error(`The work center for ${stage.name} no longer exists.`);
      for (const date of daysBetween(cursor.date, endDate)) {
        if (remaining <= 0) break;
        for (const window of available(machine, date)) {
          const startMinute = Math.max(
            window.start,
            date === cursor.date ? cursor.minute : 0,
            date === startDate ? nowCursor.minute : 0,
          );
          const minutes = Math.min(remaining, window.end - startMinute);
          if (minutes <= 0) continue;
          add({
            id: `${order.id}:${stage.id}:${date}:${startMinute}`,
            orderId: order.id,
            stageId: stage.id,
            machineId: machine.id,
            date,
            startMinute,
            minutes,
            locked: stage.status === "in_progress",
            manual: false,
          });
          remaining -= minutes;
          cursor = { date, minute: startMinute + minutes };
          if (!remaining) break;
        }
      }
      if (remaining > 0) {
        risks.push({
          id: `capacity:${order.id}`,
          orderId: order.id,
          code: "capacity",
          severity: "critical",
          message: `${Math.ceil((remaining / 60) * 100) / 100} hours of ${stage.name} cannot fit before ${endDate}. Later stages remain unplanned.`,
        });
        break;
      }
    }
    if (byOrder.has(order.id)) reserve(order, supply);
  }
  return evaluatePlan(input, allocations, risks, strategy, now);
}

export function evaluatePlan(
  input: PlanningInput,
  allocations: Allocation[],
  baseRisks: Risk[],
  strategy: Plan["strategy"],
  now = new Date(),
): Plan {
  const startDate = localDay(input.tenant.timeZone, now),
    endDate = addDays(startDate, input.tenant.horizonDays - 1);
  const grouped = new Map<string, Allocation[]>(),
    riskGroups = new Map<string, Risk[]>(),
    orderMap = new Map(input.orders.map((o) => [o.id, o]));
  for (const a of allocations) {
    const group = grouped.get(a.orderId);
    if (group) group.push(a);
    else grouped.set(a.orderId, [a]);
  }
  for (const r of baseRisks) {
    const group = riskGroups.get(r.orderId);
    if (group) group.push(r);
    else riskGroups.set(r.orderId, [r]);
  }
  const orders: OrderPlan[] = input.orders.map((order) => {
    const jobs = (grouped.get(order.id) ?? []).sort(ordered),
      stageTotals = new Map<string, number>();
    for (const job of jobs)
      stageTotals.set(
        job.stageId,
        (stageTotals.get(job.stageId) ?? 0) + job.minutes,
      );
    const requiredMinutes = orderMinutes(order),
      plannedMinutes = jobs.reduce((sum, a) => sum + a.minutes, 0);
    const start = jobs[0]?.date ?? null;
    const fullyPlanned = order.stages.every(
      (stage) =>
        stage.status === "completed" ||
        (stageTotals.get(stage.id) ?? 0) === stageMinutes(order, stage),
    );
    const finish = order.completedAt
      ? localDay(input.tenant.timeZone, new Date(order.completedAt))
      : fullyPlanned && jobs.length
        ? jobs.at(-1)!.date
        : null;
    const risks = (riskGroups.get(order.id) ?? []).filter(
      (risk) => !["deadline", "delay"].includes(risk.code),
    );
    let status: OrderPlan["status"] = jobs.length ? "scheduled" : "queued";
    if (order.cancelledAt) status = "cancelled";
    else if (order.completedAt) {
      status = "completed";
      if (finish! > order.deadline)
        risks.push({
          id: `late-complete:${order.id}`,
          orderId: order.id,
          code: "delay",
          severity: "critical",
          message: `Production completed ${dayDifference(finish!, order.deadline)} day(s) after the requested deadline.`,
        });
      if (!order.deliveredAt && startDate > order.deadline)
        risks.push({
          id: `delivery:${order.id}`,
          orderId: order.id,
          code: "deadline",
          severity: "critical",
          message: `Production is complete, but delivery has not been confirmed. The delivery deadline was ${order.deadline}.`,
        });
    } else {
      if (order.stages.some((s) => s.status === "in_progress"))
        status = "in_progress";
      if (
        !fullyPlanned &&
        !risks.some(
          (risk) =>
            risk.code === "material" ||
            risk.code === "hold" ||
            risk.code === "capacity",
        )
      )
        risks.push({
          id: `capacity:${order.id}`,
          orderId: order.id,
          code: "capacity",
          severity: "critical",
          message: `${Math.ceil(((requiredMinutes - plannedMinutes) / 60) * 100) / 100} hours remain outside this planning horizon.`,
        });
      if (risks.some((r) => r.code === "material" && r.severity === "critical"))
        status = "blocked";
      else if (risks.length || !fullyPlanned) status = "at_risk";
      if (order.stages.some((s) => s.status === "on_hold")) status = "on_hold";
      if (startDate > order.deadline || (finish && finish > order.deadline)) {
        if (!["blocked", "on_hold"].includes(status)) status = "delayed";
        risks.push({
          id: `deadline:${order.id}`,
          orderId: order.id,
          code: "deadline",
          severity: "critical",
          message:
            startDate > order.deadline
              ? `The delivery deadline was ${order.deadline}; production is still unfinished.`
              : `Forecast completion ${finish} is ${dayDifference(finish!, order.deadline)} day(s) after the deadline.`,
        });
      } else if (
        finish &&
        dayDifference(order.deadline, finish) < input.tenant.dispatchBufferDays
      ) {
        if (status === "scheduled") status = "at_risk";
        risks.push({
          id: `buffer:${order.id}`,
          orderId: order.id,
          code: "deadline",
          severity: "warning",
          message: `Completion on ${finish} leaves less than the ${input.tenant.dispatchBufferDays}-day dispatch buffer.`,
        });
      }
    }
    return {
      orderId: order.id,
      status,
      start,
      finish,
      requiredMinutes,
      plannedMinutes,
      risks: order.cancelledAt ? [] : risks,
    };
  });
  const open = orders.filter(
    (r) => !["completed", "cancelled"].includes(r.status),
  );
  return {
    startDate,
    endDate,
    generatedAt: now.toISOString(),
    allocations,
    orders,
    risks: orders.flatMap((o) => o.risks),
    strategy,
    score: {
      lateOrders: open.filter((o) =>
        o.risks.some((r) => r.code === "deadline" && r.severity === "critical"),
      ).length,
      lateDays: open.reduce(
        (sum, o) =>
          sum +
          Math.max(
            0,
            dayDifference(
              o.finish ?? addDays(endDate, 1),
              orderMap.get(o.orderId)!.deadline,
            ),
          ),
        0,
      ),
      blockedOrders: open.filter((o) => o.plannedMinutes < o.requiredMinutes)
        .length,
      plannedMinutes: open.reduce((sum, o) => sum + o.plannedMinutes, 0),
    },
  };
}

export function validatePlan(
  input: PlanningInput,
  plan: Plan,
  now = new Date(plan.generatedAt),
): string[] {
  const errors: string[] = [];
  const today = localDay(input.tenant.timeZone, now),
    minute = localMinute(input.tenant.timeZone, now);
  const orders = new Map(input.orders.map((order) => [order.id, order])),
    machines = new Map(input.machines.map((machine) => [machine.id, machine]));
  const stages = new Map(
    input.orders.flatMap((order) =>
      order.stages.map((stage) => [`${order.id}:${stage.id}`, stage] as const),
    ),
  );
  const byStage = new Map<string, Allocation[]>(),
    byOrder = new Map<string, Allocation[]>(),
    byMachineDay = new Map<string, Allocation[]>(),
    totals = new Map<string, number>(),
    windows = new Map<string, Window[]>();
  for (const job of plan.allocations) {
    for (const [map, key] of [
      [byStage, `${job.orderId}:${job.stageId}`],
      [byOrder, job.orderId],
      [byMachineDay, `${job.machineId}:${job.date}`],
    ] as const) {
      const group = map.get(key);
      if (group) group.push(job);
      else map.set(key, [job]);
    }
    const key = `${job.orderId}:${job.stageId}`;
    totals.set(key, (totals.get(key) ?? 0) + job.minutes);
  }
  for (const group of [
    ...byStage.values(),
    ...byOrder.values(),
    ...byMachineDay.values(),
  ])
    group.sort(ordered);
  for (const group of byMachineDay.values()) {
    let previous: Allocation | undefined;
    for (const job of group) {
      if (previous && previous.startMinute + previous.minutes > job.startMinute)
        errors.push(
          `${orders.get(job.orderId)?.number ?? "Order"}: work center capacity is already occupied.`,
        );
      if (
        !previous ||
        job.startMinute + job.minutes > previous.startMinute + previous.minutes
      )
        previous = job;
    }
  }
  if (
    new Set(plan.allocations.map((a) => a.id)).size !== plan.allocations.length
  )
    errors.push("Production segments must have unique identifiers.");
  for (const job of plan.allocations) {
    const order = orders.get(job.orderId),
      stage = stages.get(`${job.orderId}:${job.stageId}`),
      machine = machines.get(job.machineId);
    if (
      !order ||
      !stage ||
      !machine ||
      stage.machineId !== job.machineId ||
      order.cancelledAt
    ) {
      errors.push(
        "A segment references an unavailable order, stage or work center.",
      );
      continue;
    }
    const windowKey = `${machine.id}:${job.date}`;
    let available = windows.get(windowKey);
    if (!available) {
      available = workingWindows(machine, job.date);
      windows.set(windowKey, available);
    }
    if (
      job.date < plan.startDate ||
      job.date > plan.endDate ||
      job.date < today ||
      (job.date === today && job.startMinute < minute)
    )
      errors.push(
        `${order.number}: remaining production must fit inside the future planning horizon.`,
      );
    if (
      job.minutes <= 0 ||
      !available.some(
        (w) =>
          job.startMinute >= w.start && job.startMinute + job.minutes <= w.end,
      )
    )
      errors.push(
        `${order.number}: ${stage.name} falls outside available shifts or overlaps downtime.`,
      );
    if (
      (totals.get(`${order.id}:${stage.id}`) ?? 0) > stageMinutes(order, stage)
    )
      errors.push(
        `${order.number}: ${stage.name} has more time allocated than remaining work.`,
      );
    const predecessor = order.stages.find(
      (s) => s.sequence === stage.sequence - 1,
    );
    if (
      predecessor?.completedAt &&
      compareCursor(
        {
          date: localDay(
            input.tenant.timeZone,
            new Date(predecessor.completedAt),
          ),
          minute: localMinute(
            input.tenant.timeZone,
            new Date(predecessor.completedAt),
          ),
        },
        startOf(job),
      ) > 0
    )
      errors.push(
        `${order.number}: ${stage.name} must follow the actual completion of ${predecessor.name}.`,
      );
    if (predecessor && predecessor.status !== "completed") {
      const previous = byStage.get(`${order.id}:${predecessor.id}`) ?? [];
      if (
        (totals.get(`${order.id}:${predecessor.id}`) ?? 0) <
          stageMinutes(order, predecessor) ||
        !previous.length ||
        compareCursor(endOf(previous.at(-1)!), startOf(job)) > 0
      )
        errors.push(
          `${order.number}: ${stage.name} must follow ${predecessor.name}.`,
        );
    }
  }
  const supply = supplies(input, plan.startDate);
  const plannedOrders = input.orders
    .filter((o) => !o.materialsIssued && !o.cancelledAt && byOrder.has(o.id))
    .sort((a, b) =>
      byOrder.get(a.id)![0].date.localeCompare(byOrder.get(b.id)![0].date),
    );
  for (const order of plannedOrders) {
    const first = byOrder.get(order.id)![0];
    const ready = materialReady(input, order, supply, plan.startDate);
    if (ready.risks.length || ready.date > first.date)
      errors.push(
        `${order.number}: material is not available by the production start date.`,
      );
    else reserve(order, supply);
  }
  return [...new Set(errors)];
}

export function moveSegment(
  input: PlanningInput,
  plan: Plan,
  allocationId: string,
  date: string,
  locked: boolean,
  now = new Date(),
  requestedStartMinute?: number,
): Plan {
  if (
    requestedStartMinute !== undefined &&
    (!Number.isInteger(requestedStartMinute) ||
      requestedStartMinute < 0 ||
      requestedStartMinute > 1439)
  )
    throw new Error("Choose a valid start time from 00:00 to 23:59.");
  const job = plan.allocations.find((a) => a.id === allocationId);
  if (!job) throw new Error("This segment no longer exists. Refresh the plan.");
  const stage = input.orders
    .find((o) => o.id === job.orderId)!
    .stages.find((s) => s.id === job.stageId)!;
  if (stage.status !== "queued")
    throw new Error("Only queued production can be moved.");
  const today = localDay(input.tenant.timeZone, now);
  if (date < today || date > plan.endDate)
    throw new Error("Choose a date inside the current planning horizon.");
  const machine = input.machines.find((m) => m.id === job.machineId)!;
  const others = plan.allocations.filter((a) => a.id !== job.id);
  const order = input.orders.find((o) => o.id === job.orderId)!;
  const predecessor = order.stages.find(
    (s) => s.sequence === stage.sequence - 1,
  );
  const previous = predecessor
    ? others
        .filter((a) => a.orderId === order.id && a.stageId === predecessor.id)
        .sort(ordered)
        .at(-1)
    : undefined;
  let earliest = {
    date: today,
    minute: localMinute(input.tenant.timeZone, now),
  };
  if (previous) earliest = later(earliest, endOf(previous));
  if (predecessor?.completedAt)
    earliest = later(earliest, {
      date: localDay(input.tenant.timeZone, new Date(predecessor.completedAt)),
      minute: localMinute(
        input.tenant.timeZone,
        new Date(predecessor.completedAt),
      ),
    });
  const successorIds = order.stages
    .filter((s) => s.sequence > stage.sequence)
    .map((s) => s.id);
  const successor = others
    .filter((a) => a.orderId === order.id && successorIds.includes(a.stageId))
    .sort(ordered)[0];
  if (date < earliest.date || (successor && date > successor.date))
    throw new Error(
      "Choose a day between the preceding and following production stages.",
    );
  const available = freeWindows(machine, date, others)
    .map((w) => ({
      start: Math.max(w.start, date === earliest.date ? earliest.minute : 0),
      end: Math.min(
        w.end,
        successor?.date === date ? successor.startMinute : 1440,
      ),
    }))
    .find((w) =>
      requestedStartMinute === undefined
        ? w.end - w.start >= job.minutes
        : requestedStartMinute >= w.start &&
          requestedStartMinute + job.minutes <= w.end,
    );
  if (!available)
    throw new Error(
      requestedStartMinute === undefined
        ? "There is no continuous free window for this segment on that day."
        : "That start time cannot fit this stage. Check preceding and following stages, occupied capacity, shifts and downtime. Choose another time or use first available.",
    );
  const allocations = [
    ...others,
    {
      ...job,
      date,
      startMinute: requestedStartMinute ?? available.start,
      manual: true,
      locked,
    },
  ];
  // The move replaces this stage's old position. Validate the new position below
  // rather than retaining a predecessor warning from the temporary refresh.
  const risks = plan.risks.filter((risk) => risk.id !== `locked:${stage.id}`);
  const next = evaluatePlan(input, allocations, risks, plan.strategy, now);
  const violations = validatePlan(input, next, now);
  if (violations.length) throw new Error(violations[0]);
  return next;
}
