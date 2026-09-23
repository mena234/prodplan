export function localDay(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function addDays(day: string, amount: number) {
  return new Date(Date.parse(day + "T00:00:00Z") + amount * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function localMinute(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return (
    Number(parts.find((p) => p.type === "hour")!.value) * 60 +
    Number(parts.find((p) => p.type === "minute")!.value)
  );
}
export function dayDifference(a: string, b: string) {
  return Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
}
export function milli(value: number) {
  return Math.round(value * 1000);
}
export function quantity(value: number, unit: string) {
  return `${(value / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} ${unit}`;
}
