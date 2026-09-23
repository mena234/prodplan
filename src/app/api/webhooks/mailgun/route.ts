import { z } from "zod";
import { getRuntime } from "@/production/server/runtime";
import { errorResponse, HttpError, readBody } from "@/production/server/http";
import { validMailgunSignature } from "@/production/server/providers";
const envelope = z.object({
  signature: z.object({
    timestamp: z.string(),
    token: z.string(),
    signature: z.string(),
  }),
  "event-data": z.object({
    event: z.string(),
    timestamp: z.number().finite().positive(),
    severity: z.string().optional(),
    message: z.object({
      headers: z.object({ "message-id": z.string().max(500) }),
    }),
    "user-variables": z.record(z.string(), z.unknown()).optional(),
  }),
});
export async function POST(request: Request) {
  try {
    const env = getRuntime(),
      raw = await readBody(request, 100000);
    if (!env.MAILGUN_WEBHOOK_SIGNING_KEY || !env.MAILGUN_DOMAIN)
      throw new HttpError(503, "Mailgun event verification is not configured.");
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "Invalid event.");
    }
    const parsed = envelope.safeParse(json);
    if (
      !parsed.success ||
      !(await validMailgunSignature(
        env.MAILGUN_WEBHOOK_SIGNING_KEY,
        parsed.data.signature,
      ))
    )
      throw new HttpError(401, "Invalid event signature.");
    const event = parsed.data["event-data"],
      providerId = event.message.headers["message-id"].replace(/^<|>$/g, ""),
      suffix = `@${env.MAILGUN_DOMAIN}`;
    if (!providerId.startsWith("prodplan-") || !providerId.endsWith(suffix))
      throw new HttpError(400, "Unrecognized message.");
    const id = providerId.slice("prodplan-".length, -suffix.length);
    if (
      !z.uuid().safeParse(id).success ||
      (event["user-variables"]?.outbox_id &&
        event["user-variables"].outbox_id !== id)
    )
      throw new HttpError(400, "Unrecognized message.");
    const status =
      event.event === "delivered"
        ? "delivered"
        : event.event === "accepted"
          ? "accepted"
          : event.event === "failed"
            ? event.severity === "permanent"
              ? "failed"
              : "deferred"
            : null;
    if (status) {
      // Repeated events are idempotent. Delivered is terminal even when an
      // earlier acceptance arrives late. Mailgun owns delivery retries.
      const now = new Date().toISOString();
      await env.DB.prepare(
        "UPDATE email_outbox SET status=?,provider_id=?,provider_event_at=?,sent_at=COALESCE(sent_at,?),delivered_at=CASE WHEN ?='delivered' THEN ? ELSE delivered_at END,last_error=CASE WHEN ? IN ('failed','deferred') THEN 'Mailgun reported a delivery failure. Review the provider log.' ELSE NULL END WHERE id=? AND status NOT IN ('cancelled','delivered') AND (provider_event_at IS NULL OR provider_event_at<=?)",
      )
        .bind(
          status,
          `<${providerId}>`,
          event.timestamp,
          now,
          status,
          now,
          status,
          id,
          event.timestamp,
        )
        .run();
    }
    return Response.json({ received: true });
  } catch (error) {
    return errorResponse(error);
  }
}
