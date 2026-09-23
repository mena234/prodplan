"use client";
import { useEffect, useState } from "react";
import { FormDialog, Field } from "./forms";
import { api } from "./client";
import type { Member, Role, Workspace } from "../types";
type Team = {
  members: Member[];
  invitations: Array<{
    id: string;
    email: string;
    role: Role;
    expiresAt: string;
    acceptedAt: string | null;
    revokedAt: string | null;
  }>;
  mail: Array<{ status: string; total: number }>;
};
export function TeamView({
  data,
  refresh,
}: {
  data: Workspace;
  refresh: () => Promise<void>;
}) {
  const [team, setTeam] = useState<Team | null>(null),
    [error, setError] = useState(""),
    [dialog, setDialog] = useState<{
      kind: "invite" | "member" | "revoke";
      revision?: number;
      member?: Member;
      id?: string;
    } | null>(null);
  useEffect(() => {
    let active = true;
    api<Team>(`team?tenantId=${data.tenant.id}`)
      .then((result) => {
        if (active) setTeam(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [data.tenant.id, data.tenant.revision]);
  async function change(action: unknown) {
    try {
      await api("team", {
        tenantId: data.tenant.id,
        revision: dialog?.revision ?? data.tenant.revision,
        ...(action as object),
      });
    } catch (error) {
      await refresh();
      throw error;
    }
    await refresh();
  }
  return (
    <>
      <div className="p-toolbar">
        <p className="muted">Access is enforced for every workspace request.</p>
        <button
          className="button primary"
          disabled={data.integrations.emailDisabled}
          onClick={() =>
            setDialog({ kind: "invite", revision: data.tenant.revision })
          }
        >
          Invite member
        </button>
      </div>
      {data.integrations.emailDisabled && (
        <p className="muted">
          Team invitations are paused while email is disabled.
        </p>
      )}
      {error && (
        <p className="p-error" role="alert">
          {error}
        </p>
      )}
      <div className="p-panel p-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Email</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {team?.members.map((m) => (
              <tr key={m.userId}>
                <td>
                  {m.name}
                  {m.userId === data.user.id && <small> · You</small>}
                </td>
                <td>{m.email}</td>
                <td className="capitalize">{m.role}</td>
                <td>
                  <button
                    className="button"
                    onClick={() =>
                      setDialog({
                        kind: "member",
                        member: m,
                        revision: data.tenant.revision,
                      })
                    }
                  >
                    Manage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-role-guide">
        <p>
          <strong>Admin</strong> · Full access, team and settings.
        </p>
        <p>
          <strong>Planner</strong> · Orders, stock, master data and scheduling.
        </p>
        <p>
          <strong>Floor supervisor</strong> · Read all production data and
          update production stages.
        </p>
        <p>
          <strong>Viewer</strong> · Read-only access and reports.
        </p>
      </div>
      <h2 className="p-section-title">Invitations</h2>
      <div className="p-panel p-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {team?.invitations.map((i) => (
              <tr key={i.id}>
                <td>{i.email}</td>
                <td>{i.role}</td>
                <td>
                  {i.revokedAt
                    ? "Revoked"
                    : i.acceptedAt
                      ? "Accepted"
                      : i.expiresAt < new Date().toISOString()
                        ? "Expired"
                        : "Pending"}
                </td>
                <td>
                  {!i.revokedAt && !i.acceptedAt && (
                    <button
                      className="button"
                      onClick={() =>
                        setDialog({
                          kind: "revoke",
                          id: i.id,
                          revision: data.tenant.revision,
                        })
                      }
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!team?.invitations.length && (
          <p className="p-empty">No invitations yet.</p>
        )}
      </div>
      <h2 className="p-section-title">Email delivery</h2>
      <p className="muted">
        {data.integrations.emailDisabled
          ? "Email is temporarily disabled. In-app notifications remain available."
          : data.integrations.email
            ? "Email service connected."
            : "Email service needs a verified sender and provider credentials."}
      </p>
      <div className="p-actions">
        {team?.mail.map((m) => (
          <span className="p-status" key={m.status}>
            {m.total} {m.status}
          </span>
        ))}
      </div>
      {dialog?.kind === "invite" && (
        <FormDialog
          key={dialog.revision}
          reload={() =>
            setDialog({ ...dialog, revision: data.tenant.revision })
          }
          title="Invite a team member"
          close={() => setDialog(null)}
          submit={async (f) =>
            change({
              action: "invite",
              email: String(f.get("email")),
              role: String(f.get("role")),
            })
          }
        >
          <Field label="Email address">
            <input name="email" type="email" required maxLength={254} />
          </Field>
          <Field label="Role">
            <select name="role" defaultValue="viewer">
              {["admin", "planner", "supervisor", "viewer"].map((role) => (
                <option key={role}>{role}</option>
              ))}
            </select>
          </Field>
          <p className="muted">
            They will receive a link valid for 7 days and must verify this email
            address.
          </p>
        </FormDialog>
      )}
      {dialog?.kind === "member" && dialog.member && (
        <FormDialog
          key={dialog.revision}
          reload={() =>
            setDialog({ ...dialog, revision: data.tenant.revision })
          }
          title={`Manage ${dialog.member.name}`}
          close={() => setDialog(null)}
          submit={async (f) =>
            change(
              String(f.get("role")) === "remove"
                ? { action: "remove", userId: dialog.member!.userId }
                : {
                    action: "role",
                    userId: dialog.member!.userId,
                    role: String(f.get("role")),
                  },
            )
          }
        >
          <Field label="Workspace access">
            <select name="role" defaultValue={dialog.member.role}>
              {["admin", "planner", "supervisor", "viewer"].map((role) => (
                <option key={role}>{role}</option>
              ))}
              <option value="remove">Remove from this workspace</option>
            </select>
          </Field>
          <p className="muted">
            Changes apply immediately. The workspace must retain at least one
            administrator.
          </p>
        </FormDialog>
      )}
      {dialog?.kind === "revoke" && (
        <FormDialog
          key={dialog.revision}
          reload={() =>
            setDialog({ ...dialog, revision: data.tenant.revision })
          }
          title="Revoke invitation"
          close={() => setDialog(null)}
          submit={async () =>
            change({ action: "revoke", invitationId: dialog.id })
          }
        >
          <p>
            The invitation link will stop working. You can send a new invitation
            later.
          </p>
        </FormDialog>
      )}
    </>
  );
}
