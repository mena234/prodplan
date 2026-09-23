import { z } from "zod";
import { memberAccess } from "@/production/server/access";
import { getRuntime } from "@/production/server/runtime";
import {
  errorResponse,
  HttpError,
  requireOrigin,
  readJson,
} from "@/production/server/http";
export async function POST(request: Request) {
  try {
    const env = getRuntime();
    await requireOrigin(request, env.BETTER_AUTH_URL!);
    const parsed = z
      .object({ tenantId: z.string().uuid(), id: z.string().uuid().optional() })
      .safeParse(await readJson(request));
    if (!parsed.success)
      throw new HttpError(400, "Choose a valid notification.");
    const { user } = await memberAccess(request.headers, parsed.data.tenantId);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO notification_reads(notification_id,user_id,read_at) SELECT n.id,?,? FROM platform_notifications n JOIN tenant_memberships m ON m.tenant_id=n.tenant_id AND m.user_id=? WHERE n.tenant_id=?${parsed.data.id ? " AND n.id=?" : ""}`,
    )
      .bind(
        user.id,
        new Date().toISOString(),
        user.id,
        parsed.data.tenantId,
        ...(parsed.data.id ? [parsed.data.id] : []),
      )
      .run();
    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
