import type { Allocation, Day, Machine, Order } from "../domain/types";
export interface Window {
  start: number;
  end: number;
}
export function daysBetween(start: Day, end: Day): Day[] {
  const days: Day[] = [];
  for (
    let t = Date.parse(start + "T00:00:00Z");
    t <= Date.parse(end + "T00:00:00Z");
    t += 86400000
  )
    days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}
export function subtract(windows: Window[], block: Window): Window[] {
  return windows.flatMap((w) =>
    block.end <= w.start || block.start >= w.end
      ? [w]
      : [
          { start: w.start, end: Math.min(w.end, block.start) },
          { start: Math.max(w.start, block.end), end: w.end },
        ].filter((x) => x.end > x.start),
  );
}
export function workingWindows(machine: Machine, day: Day): Window[] {
  const weekday = new Date(day + "T00:00:00Z").getUTCDay();
  let windows = machine.shifts
    .filter((s) => s.weekday === weekday)
    .map((s) => ({ start: s.startMinute, end: s.endMinute }))
    .sort((a, b) => a.start - b.start);
  // Apply the contractual daily cap before maintenance: lost production is not made up outside the shift.
  let remaining = machine.dailyCapacityMinutes;
  windows = windows.flatMap((w) => {
    const minutes = Math.min(remaining, w.end - w.start);
    remaining -= minutes;
    return minutes > 0 ? [{ start: w.start, end: w.start + minutes }] : [];
  });
  for (const d of machine.downtime.filter((d) => d.date === day))
    windows = subtract(windows, { start: d.startMinute, end: d.endMinute });
  return windows;
}
export function freeWindows(
  machine: Machine,
  day: Day,
  allocations: Allocation[],
): Window[] {
  let windows = workingWindows(machine, day);
  for (const a of allocations.filter(
    (a) => a.machineId === machine.id && a.date === day,
  ))
    windows = subtract(windows, {
      start: a.startMinute,
      end: a.startMinute + a.minutes,
    });
  return windows;
}
export const capacity = (machine: Machine, day: Day) =>
  workingWindows(machine, day).reduce((n, w) => n + w.end - w.start, 0);
export const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
export const compareOrders = (a: Order, b: Order) =>
  priorityRank[a.priority] - priorityRank[b.priority] ||
  a.deadline.localeCompare(b.deadline) ||
  a.id.localeCompare(b.id);
export const hours = (minutes: number) =>
  Number((minutes / 60).toFixed(2)) + "h";
export const kg = (grams: number) => Number((grams / 1000).toFixed(3)) + " kg";
