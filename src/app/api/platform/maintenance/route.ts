import { getRuntime } from "@/production/server/runtime";
import { flushMail } from "@/production/server/mail";
import { refreshDateRisks } from "@/production/server/daily-risks";
import { cleanupDemos } from "@/production/server/demo-session";
import {
  discardBody,
  errorResponse,
  HttpError,
  readJson,
} from "@/production/server/http";
export async function POST(request: Request) {
  try {
    const env = getRuntime(),
      expected = env.CRON_SECRET,
      provided = request.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!expected || !provided) {
      await discardBody(request);
      throw new HttpError(401, "Unauthorized.");
    }
    const hashes = await Promise.all(
        [expected, provided].map((s) =>
          crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
        ),
      ),
      a = new Uint8Array(hashes[0]),
      b = new Uint8Array(hashes[1]);
    let difference = 0;
    for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
    if (difference) {
      await discardBody(request);
      throw new HttpError(401, "Unauthorized.");
    }
    const body = (await readJson(request)) as { cursor?: unknown };
    if (
      body.cursor !== undefined &&
      (typeof body.cursor !== "string" || body.cursor.length > 100)
    )
      throw new HttpError(400, "Invalid cursor.");
    const units = await env.DB.prepare(
      "SELECT id FROM tenants WHERE id>? AND NOT EXISTS(SELECT 1 FROM live_demo_sessions d WHERE d.tenant_id=tenants.id) ORDER BY id LIMIT 2",
    )
      .bind(body.cursor ?? "")
      .all<{ id: string }>();
    const unit = units.results[0],
      result = unit
        ? await refreshDateRisks(unit.id)
        : { notifications: 0, more: false };
    await flushMail(env);
    await cleanupDemos(env);
    const statuses = await env.DB.prepare(
      "SELECT status,COUNT(*) AS total FROM email_outbox GROUP BY status",
    ).all<{ status: string; total: number }>();
    return Response.json({
      processedUnits: unit ? 1 : 0,
      newNotifications: result.notifications,
      nextCursor: result.more
        ? (body.cursor ?? "")
        : units.results.length > 1
          ? unit.id
          : null,
      email: statuses.results,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
