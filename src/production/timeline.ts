import { addDays } from "./dates";

/** Keep the grabbed position stable while snapping the start to the chosen step. */
export function dragTime(
  date: string,
  startMinute: number,
  deltaMinutes: number,
  snapMinutes: number,
) {
  const total =
    Math.round((startMinute + deltaMinutes) / snapMinutes) * snapMinutes;
  const dayOffset = Math.floor(total / 1440);
  return {
    date: addDays(date, dayOffset),
    startMinute: total - dayOffset * 1440,
  };
}
