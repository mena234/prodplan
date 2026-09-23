export const isDemoMode = () =>
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("demo") === "1";
export const appUrl = (tenantId?: string) =>
  `/app?${isDemoMode() ? "demo=1&" : ""}${tenantId ? `unit=${tenantId}` : ""}`;
export const reportUrl = (tenantId: string, format: string) =>
  `/api/platform/reports?tenantId=${tenantId}&format=${format}${isDemoMode() ? "&demo=1" : ""}`;
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const options: RequestInit =
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          body: JSON.stringify(body),
        };
  options.headers = {
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(isDemoMode() ? { "x-prodplan-demo": "1" } : {}),
  };
  const retryable =
    body === undefined ||
    (typeof body === "object" && body !== null && "key" in body);
  let response: Response;
  try {
    response = await fetch(`/api/platform/${path}`, {
      ...options,
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    if (!retryable) throw error;
    response = await fetch(`/api/platform/${path}`, {
      ...options,
      signal: AbortSignal.timeout(20000),
    });
  }
  const result = (await response.json()) as { error?: string; code?: string };
  if (!response.ok) {
    // Discard the authenticated client tree when the session expires.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (response.status === 401) location.assign("/login");
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (result.code === "DEMO_EXPIRED") location.assign("/?demo=expired");
    throw new Error(result.error ?? "This request could not be completed.");
  }
  return result as T;
}
