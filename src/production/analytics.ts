import { workingWindows, daysBetween } from "../scheduling/constraints";
import { localDay } from "./dates";
import type { Workspace } from "./types";

export function analytics(
  data: Pick<Workspace, "orders" | "machines" | "plan" | "tenant">,
  now = new Date(),
) {
  const active = data.orders.filter((o) => !o.cancelledAt && !o.completedAt);
  const completed = data.orders.filter((o) => o.completedAt && !o.cancelledAt);
  const delivered = data.orders.filter((o) => o.deliveredAt && !o.cancelledAt);
  const onTime = delivered.filter(
    (o) =>
      localDay(data.tenant.timeZone, new Date(o.deliveredAt!)) <= o.deadline,
  ).length;
  const today = localDay(data.tenant.timeZone, now);
  const days = data.plan
    ? daysBetween(data.plan.startDate, data.plan.endDate)
    : [];
  const utilization = data.machines.map((machine) => {
    const available = days.reduce(
      (sum, date) =>
        sum +
        workingWindows(machine, date).reduce(
          (total, w) => total + w.end - w.start,
          0,
        ),
      0,
    );
    const planned =
      data.plan?.allocations
        .filter((a) => a.machineId === machine.id)
        .reduce((sum, a) => sum + a.minutes, 0) ?? 0;
    return {
      id: machine.id,
      name: machine.name,
      available,
      planned,
      percent: available ? Math.round((planned / available) * 100) : 0,
    };
  });
  const throughput = completed.reduce((sum, o) => sum + o.quantity, 0);
  const productiveMinutes = data.orders.reduce(
    (total, o) =>
      total +
      o.stages.reduce(
        (sum, s) =>
          sum +
          s.workSessions.reduce(
            (minutes, interval) =>
              minutes +
              Math.max(
                0,
                ((interval.endedAt
                  ? new Date(interval.endedAt)
                  : now
                ).getTime() -
                  new Date(interval.startedAt).getTime()) /
                  60000,
              ),
            0,
          ),
        0,
      ),
    0,
  );
  return {
    active: active.length,
    completed: completed.length,
    delivered: delivered.length,
    onTime,
    onTimePercent: delivered.length
      ? Math.round((onTime / delivered.length) * 100)
      : null,
    overdue: data.orders.filter(
      (o) => !o.cancelledAt && !o.deliveredAt && o.deadline < today,
    ).length,
    throughput,
    productiveMinutes,
    utilization,
  };
}
