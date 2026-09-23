import { z } from "zod";
import { memberAccess, signedIn } from "@/production/server/access";
import { getRuntime } from "@/production/server/runtime";
import {
  HttpError,
  readJson,
  requireOrigin,
  errorResponse,
  discardBody,
} from "@/production/server/http";
import { roleSchema } from "@/production/validation";
import { digest } from "@/production/server/mutations";
import { emailReady, localEmailCapture } from "@/production/server/mail";
import { isEmailDisabled } from "@/production/server/email-mode";
import { demoRequest } from "@/production/server/demo-session";
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("invite"),
    tenantId: z.string().uuid(),
    revision: z.number().int().min(0),
    email: z
      .email()
      .max(254)
      .transform((s) => s.trim().toLowerCase()),
    role: roleSchema,
  }),
  z.object({
    action: z.literal("role"),
    tenantId: z.string().uuid(),
    revision: z.number().int().min(0),
    userId: z.string().min(1).max(100),
    role: roleSchema,
  }),
  z.object({
    action: z.literal("remove"),
    tenantId: z.string().uuid(),
    revision: z.number().int().min(0),
    userId: z.string().min(1).max(100),
  }),
  z.object({
    action: z.literal("revoke"),
    tenantId: z.string().uuid(),
    revision: z.number().int().min(0),
    invitationId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("accept"),
    token: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);
export async function GET(request: Request) {
  try {
    const tenantId = new URL(request.url).searchParams.get("tenantId") ?? "";
    await memberAccess(request.headers, tenantId, "members");
    const db = getRuntime().DB;
    const results = await db.batch([
      db
        .prepare(
          "SELECT u.id AS userId,u.name,u.email,m.role FROM tenant_memberships m JOIN user u ON u.id=m.user_id WHERE m.tenant_id=? ORDER BY u.name",
        )
        .bind(tenantId),
      db
        .prepare(
          "SELECT id,email,role,expires_at AS expiresAt,accepted_at AS acceptedAt,revoked_at AS revokedAt FROM tenant_invitations WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(tenantId),
      db
        .prepare(
          "SELECT status,COUNT(*) AS total FROM email_outbox WHERE tenant_id=? GROUP BY status",
        )
        .bind(tenantId),
    ]);
    return Response.json({
      members: results[0].results,
      invitations: results[1].results,
      mail: results[2].results,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const env = getRuntime(),
      db = env.DB;
    await requireOrigin(request, env.BETTER_AUTH_URL!);
    if (demoRequest(request.headers)) {
      await discardBody(request);
      throw new HttpError(
        403,
        "Invitations and team changes are unavailable in the demo. Create your own workspace to invite people.",
      );
    }
    const parsed = actionSchema.safeParse(await readJson(request));
    if (!parsed.success)
      throw new HttpError(400, parsed.error.issues[0].message);
    const action = parsed.data,
      now = new Date().toISOString(),
      operation = crypto.randomUUID();
    if (action.action === "accept") {
      if (isEmailDisabled(env))
        throw new HttpError(
          503,
          "Team invitations are paused while email is disabled.",
        );
      const user = await signedIn(request.headers),
        hash = await digest(action.token);
      const invite = await db
        .prepare("SELECT * FROM tenant_invitations WHERE token_hash=?")
        .bind(hash)
        .first<{
          id: string;
          tenant_id: string;
          email: string;
          role: string;
          accepted_at: string | null;
          accepted_by: string | null;
          revoked_at: string | null;
          expires_at: string;
        }>();
      if (
        !invite ||
        invite.email !== user.email.toLowerCase() ||
        invite.revoked_at ||
        invite.expires_at <= now
      )
        throw new HttpError(
          400,
          "This invitation is unavailable or belongs to another email address.",
        );
      if (invite.accepted_at) {
        const member = await db
          .prepare(
            "SELECT 1 FROM tenant_memberships WHERE tenant_id=? AND user_id=?",
          )
          .bind(invite.tenant_id, user.id)
          .first();
        if (invite.accepted_by === user.id && member)
          return Response.json({ tenantId: invite.tenant_id });
        throw new HttpError(400, "This invitation has already been used.");
      }
      const guard =
          "EXISTS(SELECT 1 FROM tenants WHERE id=? AND last_mutation_id=?)",
        values = [invite.tenant_id, operation];
      const audit = JSON.stringify({
        id: operation,
        actorId: user.id,
        actorName: user.name,
        action: "team.accept",
        targetId: user.id,
        createdAt: now,
        before: null,
        after: { email: user.email, invitationId: invite.id },
        revision: null,
      });
      const results = await db.batch([
        db
          .prepare(
            "UPDATE tenants SET revision=revision+1,last_mutation_id=? WHERE id=? AND EXISTS(SELECT 1 FROM tenant_invitations WHERE id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>? AND email=?) AND (EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=? AND user_id=?) OR ((SELECT COUNT(*) FROM tenant_memberships WHERE tenant_id=?)<250 AND (SELECT COUNT(*) FROM tenant_memberships WHERE user_id=?)<20))",
          )
          .bind(
            operation,
            invite.tenant_id,
            invite.id,
            now,
            user.email.toLowerCase(),
            invite.tenant_id,
            user.id,
            invite.tenant_id,
            user.id,
          ),
        db
          .prepare(
            `INSERT OR IGNORE INTO tenant_memberships(tenant_id,user_id,role,created_at) SELECT ?,?,?,? WHERE ${guard}`,
          )
          .bind(invite.tenant_id, user.id, invite.role, now, ...values),
        db
          .prepare(
            `UPDATE tenant_invitations SET accepted_at=?,accepted_by=? WHERE id=? AND ${guard}`,
          )
          .bind(now, user.id, invite.id, ...values),
        db
          .prepare(
            `INSERT INTO audit_entries(id,tenant_id,actor_id,revision,created_at,action,document) SELECT ?,?,?,revision,?,'team.accept',json_set(?,'$.revision',revision) FROM tenants WHERE id=? AND last_mutation_id=?`,
          )
          .bind(operation, invite.tenant_id, user.id, now, audit, ...values),
      ]);
      if (!results[0].meta.changes)
        throw new HttpError(
          409,
          "This invitation changed, or the limit of 250 members per unit / 20 units per account was reached.",
        );
      return Response.json({ tenantId: invite.tenant_id });
    }
    const { user } = await memberAccess(
      request.headers,
      action.tenantId,
      "members",
    );
    const tenantId = action.tenantId,
      revision = action.revision + 1;
    const guard =
        "EXISTS(SELECT 1 FROM tenants WHERE id=? AND revision=? AND last_mutation_id=?)",
      values = [tenantId, revision, operation];
    let extra = "",
      extraValues: unknown[] = [],
      after: unknown = null,
      before: unknown = null;
    const writes: D1PreparedStatement[] = [];
    if (action.action === "invite") {
      if (isEmailDisabled(env))
        throw new HttpError(
          503,
          "Team invitations are paused while email is disabled.",
        );
      if (!emailReady(env) && !localEmailCapture(env))
        throw new HttpError(
          503,
          "Configure email delivery before inviting members.",
        );
      if (
        await db
          .prepare(
            "SELECT 1 FROM tenant_memberships m JOIN user u ON u.id=m.user_id WHERE m.tenant_id=? AND u.email=?",
          )
          .bind(tenantId, action.email)
          .first()
      )
        throw new HttpError(400, "This person is already a member.");
      const token = Array.from(
        crypto.getRandomValues(new Uint8Array(32)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      const id = crypto.randomUUID(),
        tokenHash = await digest(token),
        expires = new Date(Date.now() + 7 * 86400000).toISOString();
      extra =
        " AND (SELECT COUNT(*) FROM tenant_invitations WHERE tenant_id=? AND created_at>?)<50 AND (SELECT COUNT(*) FROM tenant_memberships WHERE tenant_id=?)<250";
      extraValues = [
        tenantId,
        new Date(Date.now() - 86400000).toISOString(),
        tenantId,
      ];
      writes.push(
        db
          .prepare(
            `UPDATE tenant_invitations SET revoked_at=? WHERE tenant_id=? AND email=? AND accepted_at IS NULL AND revoked_at IS NULL AND ${guard}`,
          )
          .bind(now, tenantId, action.email, ...values),
      );
      writes.push(
        db
          .prepare(
            `INSERT INTO tenant_invitations(id,tenant_id,email,role,token_hash,expires_at,created_by,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`,
          )
          .bind(
            id,
            tenantId,
            action.email,
            action.role,
            tokenHash,
            expires,
            user.id,
            now,
            ...values,
          ),
      );
      const body = `${user.name} invited you to a ProdPlan manufacturing workspace as ${action.role}.\n\nSign in or create an account with ${action.email}, then open this link:\n${env.BETTER_AUTH_URL}/app?invite=${token}\n\nThis invitation expires in 7 days.`;
      writes.push(
        db
          .prepare(
            `INSERT INTO email_outbox(id,tenant_id,dedup_key,recipient,subject,body,kind,status,attempts,next_attempt_at,created_at) SELECT ?,?,?,?,?,?,'invitation','pending',0,?,? WHERE ${guard}`,
          )
          .bind(
            crypto.randomUUID(),
            tenantId,
            id,
            action.email,
            "Your ProdPlan invitation",
            body,
            now,
            now,
            ...values,
          ),
      );
      after = {
        invitationId: id,
        email: action.email,
        role: action.role,
        expiresAt: expires,
      };
    } else if (action.action === "revoke") {
      extra =
        " AND EXISTS(SELECT 1 FROM tenant_invitations WHERE tenant_id=? AND id=? AND accepted_at IS NULL AND revoked_at IS NULL)";
      extraValues = [tenantId, action.invitationId];
      writes.push(
        db
          .prepare(
            `UPDATE tenant_invitations SET revoked_at=? WHERE tenant_id=? AND id=? AND ${guard}`,
          )
          .bind(now, tenantId, action.invitationId, ...values),
      );
      after = { invitationId: action.invitationId, revokedAt: now };
    } else {
      before = await db
        .prepare(
          "SELECT user_id AS userId,role FROM tenant_memberships WHERE tenant_id=? AND user_id=?",
        )
        .bind(tenantId, action.userId)
        .first();
      if (!before)
        throw new HttpError(
          404,
          "This member no longer belongs to the workspace.",
        );
      extra =
        " AND EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=? AND user_id=?)";
      extraValues = [tenantId, action.userId];
      if (action.action === "remove" || action.role !== "admin") {
        extra +=
          " AND (NOT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=? AND user_id=? AND role='admin') OR (SELECT COUNT(*) FROM tenant_memberships WHERE tenant_id=? AND role='admin')>1)";
        extraValues.push(tenantId, action.userId, tenantId);
      }
      if (action.action === "role")
        writes.push(
          db
            .prepare(
              `UPDATE tenant_memberships SET role=? WHERE tenant_id=? AND user_id=? AND ${guard}`,
            )
            .bind(action.role, tenantId, action.userId, ...values),
        );
      else
        writes.push(
          db
            .prepare(
              `DELETE FROM tenant_memberships WHERE tenant_id=? AND user_id=? AND ${guard}`,
            )
            .bind(tenantId, action.userId, ...values),
        );
      after =
        action.action === "role"
          ? { userId: action.userId, role: action.role }
          : null;
    }
    const audit = {
      id: operation,
      actorId: user.id,
      actorName: user.name,
      action: `team.${action.action}`,
      targetId: "userId" in action ? action.userId : null,
      createdAt: now,
      before,
      after,
      revision,
    };
    const results = await db.batch([
      db
        .prepare(
          `UPDATE tenants SET revision=?,last_mutation_id=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=? AND user_id=? AND role='admin')${extra}`,
        )
        .bind(
          revision,
          operation,
          tenantId,
          action.revision,
          tenantId,
          user.id,
          ...extraValues,
        ),
      ...writes,
      db
        .prepare(
          `INSERT INTO audit_entries(id,tenant_id,actor_id,revision,created_at,action,document) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,
        )
        .bind(
          operation,
          tenantId,
          user.id,
          revision,
          now,
          audit.action,
          JSON.stringify(audit),
          ...values,
        ),
    ]);
    if (!results[0].meta.changes)
      throw new HttpError(
        409,
        "The team changed, the invitation limit was reached, or this change would remove the last administrator. Refresh and review the team.",
      );
    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
