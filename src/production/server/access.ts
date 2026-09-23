import { auth } from "./auth";
import { getRuntime } from "./runtime";
import { HttpError } from "./http";
import { can, type Permission } from "../permissions";
import type { Role } from "../types";
import { isEmailDisabled } from "./email-mode";
import {
  demoRequest,
  requireDemoSession,
  type DemoSession,
} from "./demo-session";

export async function workspaceIdentity(
  headers: Headers,
): Promise<{
  user: { id: string; name: string; email: string };
  demo: DemoSession | null;
}> {
  if (demoRequest(headers)) {
    const demo = await requireDemoSession(headers);
    return {
      user: { id: demo.actorId, name: "Demo visitor", email: "" },
      demo,
    };
  }
  return { user: await signedIn(headers), demo: null };
}

export async function signedIn(headers: Headers) {
  const session = await auth().api.getSession({ headers });
  if (!session) throw new HttpError(401, "Sign in to continue.");
  if (!session.user.emailVerified && !isEmailDisabled(getRuntime()))
    throw new HttpError(403, "Verify your email before opening a workspace.");
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  };
}
export async function memberAccess(
  headers: Headers,
  tenantId: string,
  permission: Permission = "read",
) {
  const { user, demo } = await workspaceIdentity(headers);
  if (demo && (demo.tenantId !== tenantId || permission === "members"))
    throw new HttpError(
      403,
      demo.tenantId !== tenantId
        ? "This workspace is not available to this demo session."
        : "Team invitations and access changes are unavailable in the demo. Create your own workspace to invite your team.",
    );
  if (
    !demo &&
    (await getRuntime()
      .DB.prepare("SELECT 1 FROM live_demo_sessions WHERE tenant_id=?")
      .bind(tenantId)
      .first())
  )
    throw new HttpError(
      403,
      "Demo workspaces require their own temporary session.",
    );
  const membership = await getRuntime()
    .DB.prepare(
      "SELECT role FROM tenant_memberships WHERE tenant_id=? AND user_id=?",
    )
    .bind(tenantId, user.id)
    .first<{ role: Role }>();
  if (!membership || !can(membership.role, permission))
    throw new HttpError(
      403,
      "You do not have permission to perform this action in this workspace.",
    );
  return { user, role: membership.role, tenantId, demo };
}
export async function userMemberships(userId: string) {
  return (
    await getRuntime()
      .DB.prepare(
        "SELECT t.id AS tenantId, t.name, m.role FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? ORDER BY t.name",
      )
      .bind(userId)
      .all<{ tenantId: string; name: string; role: Role }>()
  ).results;
}
