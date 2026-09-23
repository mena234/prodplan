import type { Runtime } from "./runtime";
import { isEmailDisabled } from "./email-mode";
import { AUTH_LINK_TTL_SECONDS } from "./auth-options";
import { emailReady, sendMailgun } from "./providers";
export { emailReady } from "./providers";

export function localEmailCapture(env: Runtime) {
  return (
    !isEmailDisabled(env) &&
    env.AUTH_EMAIL_CAPTURE === "1" &&
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(env.BETTER_AUTH_URL ?? "")
  );
}
export async function enqueueMail(
  env: Runtime,
  recipient: string,
  subject: string,
  body: string,
  tenantId: string | null = null,
) {
  if (isEmailDisabled(env)) return;
  const now = new Date().toISOString();
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify([tenantId, recipient, subject, body]),
        ),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  await env.DB.prepare(
    "INSERT OR IGNORE INTO email_outbox (id,tenant_id,dedup_key,recipient,subject,body,status,attempts,next_attempt_at,created_at) VALUES (?,?,?,?,?,?,'pending',0,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      tenantId,
      digest,
      recipient,
      subject,
      body,
      now,
      now,
    )
    .run();
}
export async function flushMail(env: Runtime) {
  if (!emailReady(env)) return;
  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE email_outbox SET status='uncertain',last_error='Sending lease expired. Awaiting Mailgun events; no automatic resend.' WHERE id IN (SELECT id FROM email_outbox WHERE status='sending' AND next_attempt_at < ? ORDER BY next_attempt_at LIMIT 20)",
  )
    .bind(now)
    .run();
  const rows = await env.DB.prepare(
    "SELECT * FROM email_outbox WHERE status IN ('pending','retry') AND next_attempt_at <= ? ORDER BY created_at LIMIT 2",
  )
    .bind(now)
    .all<{
      id: string;
      tenant_id: string | null;
      dedup_key: string;
      kind: string;
      recipient: string;
      subject: string;
      body: string;
      attempts: number;
      created_at: string;
    }>();
  for (const row of rows.results) {
    const claimed = await env.DB.prepare(
      "UPDATE email_outbox SET status='sending', attempts=attempts+1, next_attempt_at=? WHERE id=? AND status IN ('pending','retry') AND next_attempt_at <= ? RETURNING attempts",
    )
      .bind(new Date(Date.now() + 5 * 60000).toISOString(), row.id, now)
      .first<{ attempts: number }>();
    if (!claimed) continue;
    if (
      row.kind === "auth" &&
      Date.parse(row.created_at) + AUTH_LINK_TTL_SECONDS * 1000 <= Date.now()
    ) {
      await env.DB.prepare(
        "UPDATE email_outbox SET status='cancelled',last_error='Authentication link has expired' WHERE id=?",
      )
        .bind(row.id)
        .run();
      continue;
    }
    if (row.kind === "invitation") {
      const active = await env.DB.prepare(
        "SELECT 1 FROM tenant_invitations WHERE id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?",
      )
        .bind(row.dedup_key, now)
        .first();
      if (!active) {
        await env.DB.prepare(
          "UPDATE email_outbox SET status='cancelled',last_error='Invitation is no longer active' WHERE id=?",
        )
          .bind(row.id)
          .run();
        continue;
      }
    }
    if (row.kind === "notification") {
      const member = await env.DB.prepare(
        "SELECT 1 FROM tenant_memberships m JOIN user u ON u.id=m.user_id WHERE m.tenant_id=? AND m.role IN ('admin','planner') AND u.email=? AND u.email_verified=1",
      )
        .bind(row.tenant_id, row.recipient)
        .first();
      if (!member) {
        await env.DB.prepare(
          "UPDATE email_outbox SET status='cancelled',last_error='Recipient no longer has access' WHERE id=?",
        )
          .bind(row.id)
          .run();
        continue;
      }
    }
    const result = await sendMailgun(env, row);
    if (result.status === "accepted") {
      await env.DB.prepare(
        "UPDATE email_outbox SET status='accepted',provider_id=?,sent_at=?,last_error=NULL WHERE id=? AND status IN ('sending','uncertain')",
      )
        .bind(result.providerId, new Date().toISOString(), row.id)
        .run();
    } else {
      await env.DB.prepare(
        "UPDATE email_outbox SET status=?,last_error=?,next_attempt_at=? WHERE id=? AND status='sending'",
      )
        .bind(
          result.status === "retry" && claimed.attempts >= 5
            ? "failed"
            : result.status,
          result.error,
          new Date(
            Date.now() + Math.min(60, 2 ** claimed.attempts) * 60000,
          ).toISOString(),
          row.id,
        )
        .run();
    }
  }
}
