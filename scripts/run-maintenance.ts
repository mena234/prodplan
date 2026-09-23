// Run every minute from an external scheduler. Supply these through its secret
// store; this script never prints the bearer token or message contents.
export {};
const base = process.env.PRODPLAN_URL,
  secret = process.env.CRON_SECRET;
if (!base || !secret)
  throw new Error(
    "Set PRODPLAN_URL and CRON_SECRET in the scheduler environment.",
  );
const origin = new URL(base);
if (
  origin.protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(origin.hostname)
)
  throw new Error("Use HTTPS for production maintenance.");
let cursor: string | null = null,
  calls = 0,
  units = 0,
  notifications = 0;
do {
  const response = await fetch(new URL("/api/platform/maintenance", origin), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cursor === null ? {} : { cursor }),
    signal: AbortSignal.timeout(55000),
  });
  if (!response.ok)
    throw new Error(
      `Maintenance failed with HTTP ${response.status}. Retry this scheduled run.`,
    );
  const result = (await response.json()) as {
    nextCursor: string | null;
    processedUnits: number;
    newNotifications: number;
  };
  cursor = result.nextCursor;
  units += result.processedUnits;
  notifications += result.newNotifications;
  calls++;
  if (calls >= 2000 && cursor !== null)
    throw new Error(
      "Maintenance exceeded its run bound. Split the tenant schedule before increasing this bound.",
    );
} while (cursor !== null);
console.log(
  `Maintenance finished: ${units} unit passes, ${notifications} new notifications.`,
);
