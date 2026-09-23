import {
  signedIn,
  workspaceIdentity,
  userMemberships,
} from "@/production/server/access";
import { demoRequest } from "@/production/server/demo-session";
import { getRuntime } from "@/production/server/runtime";
import {
  readJson,
  requireOrigin,
  errorResponse,
  HttpError,
  discardBody,
} from "@/production/server/http";
import { settingsSchema } from "@/production/validation";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { user } = await workspaceIdentity(request.headers);
    return Response.json({ user, memberships: await userMemberships(user.id) });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const env = getRuntime();
    await requireOrigin(request, env.BETTER_AUTH_URL!);
    if (demoRequest(request.headers)) {
      await discardBody(request);
      throw new HttpError(
        403,
        "Create an account to make your own workspace. Demo data will not be copied.",
      );
    }
    const user = await signedIn(request.headers);
    const parsed = settingsSchema.safeParse(await readJson(request));
    if (!parsed.success)
      throw new HttpError(400, parsed.error.issues[0].message);
    if ((await userMemberships(user.id)).length >= 20)
      throw new HttpError(
        400,
        "A user can belong to up to 20 units. Contact support to expand this limit.",
      );
    const tenantId = crypto.randomUUID(),
      now = new Date().toISOString(),
      values = parsed.data;
    const audit = {
      id: crypto.randomUUID(),
      actorId: user.id,
      actorName: user.name,
      action: "unit.create",
      targetId: tenantId,
      createdAt: now,
      before: null,
      after: values,
      revision: 0,
    };
    const results = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO tenants(id,name,time_zone,horizon_days,dispatch_buffer_days,revision,created_at) SELECT ?,?,?,?,?,0,? WHERE (SELECT COUNT(*) FROM tenant_memberships WHERE user_id=?)<20",
      ).bind(
        tenantId,
        values.name,
        values.timeZone,
        values.horizonDays,
        values.dispatchBufferDays,
        now,
        user.id,
      ),
      env.DB.prepare(
        "INSERT INTO tenant_memberships(tenant_id,user_id,role,created_at) SELECT ?,?,'admin',? WHERE EXISTS(SELECT 1 FROM tenants WHERE id=?)",
      ).bind(tenantId, user.id, now, tenantId),
      env.DB.prepare(
        "INSERT INTO audit_entries(id,tenant_id,actor_id,revision,created_at,action,document) SELECT ?,?,?,0,?,?,? WHERE EXISTS(SELECT 1 FROM tenants WHERE id=?)",
      ).bind(
        audit.id,
        tenantId,
        user.id,
        now,
        audit.action,
        JSON.stringify(audit),
        tenantId,
      ),
    ]);
    if (!results[0].meta.changes)
      throw new HttpError(400, "A user can belong to up to 20 units.");
    return Response.json({ tenantId }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
