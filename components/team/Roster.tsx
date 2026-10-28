"use client";

// The workspace roster. For every member: display name (or email, or a
// "—" placeholder when neither is set), role, joined date, and a "you" pill
// on the visitor's own row. Managers also get a role <select> (calling
// actions.changeRole) and a Remove button (calling actions.remove). Non-
// managers see the same table without the controls.
//
// The actions object comes in as a prop so the same component is shared by
// the weft.zip server-page path (where actions wrap lib/team-actions.ts
// server actions) and the desktop's Settings → Team path (where actions
// post through lib/use-team.ts to the local forwarder). No server-only
// imports here, so the bundle stays browser-safe. The action result shows
// inline below the row so a manager who runs into a permission change
// mid-rotation sees it without navigating away.
//
// A row's controls are disabled while its action is in flight, so a
// double-click can't double-fire. The role <select> only shows roles the
// actor can assign (the server bakes that into the options list passed in
// as `roleOptions`); the table here doesn't decide who's assignable.
import { useState, useTransition } from "react";
import type { TeamClientActions, TeamMember, TeamRole } from "@/lib/team-types";

// The role <select>'s options. The server filters the list to the roles
// the actor can assign (an owner sees all three, an admin sees admin +
// member, a member is never shown the select because canManage is false).
// roleLabels is the canonical "Owner/Admin/Member" map for the read-only
// case where no select is shown.
export type RoleOption = { role: TeamRole; label: string };

export type RosterMember = {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: TeamRole;
  roleLabel: string;
  joinedAt: string;
  isYou: boolean;
};

// "Owner", not "owner": the label from the options, else the role capitalized (an admin's options leave Owner out).
function roleLabelOf(role: TeamRole, roleOptions: RoleOption[]): string {
  return roleOptions.find((o) => o.role === role)?.label ?? role.charAt(0).toUpperCase() + role.slice(1);
}

function RosterMemberProps(member: TeamMember, isYou: boolean, roleLabel: string): RosterMember {
  return {
    userId: member.userId,
    email: member.email,
    displayName: member.name,
    role: member.role,
    roleLabel,
    joinedAt: member.joinedAt,
    isYou,
  };
}

function formatJoined(iso: string): string {
  // A short, locale-agnostic "Mon DD, YYYY" — the table is a list, not a
  // ledger, so absolute precision isn't useful and full ISO would dominate
  // the column.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function displayName(member: RosterMember): string {
  return member.displayName?.trim() || member.email?.trim() || "—";
}

function RosterRow({
  member,
  canManage,
  roleOptions,
  actions,
}: {
  member: RosterMember;
  canManage: boolean;
  roleOptions: RoleOption[];
  actions: TeamClientActions;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // "Rotate shared vaults" (docs/architecture/teams-vault.md, "Removal and rotation"), on by default:
  // a removal that leaves the old key in place leaves the removed party's plaintext worth
  // something, so turning the key is the safe default. It is a tick, not a separate flow — the
  // Remove button carries it.
  const [rotate, setRotate] = useState(true);

  // The role select fires the action on change. The action is idempotent
  // for the same (orgId, userId) pair, so we don't disable the select
  // while the change is in flight — a second click would just re-save the
  // same value. A small "Saving…" label on the right is enough feedback.
  function handleChangeRole(e: React.ChangeEvent<HTMLSelectElement>) {
    if (!canManage) return;
    const next = e.target.value as TeamRole;
    startTransition(async () => {
      const result = await actions.changeRole(member.userId, next);
      setMessage({
        kind: result.ok ? "ok" : "err",
        text: result.message ?? (result.ok ? "Saved." : "Couldn’t save."),
      });
    });
  }

  function handleRemove() {
    if (!canManage) return;
    const display = member.displayName?.trim() || member.email || "this member";
    const ask = rotate
      ? `Remove ${display} from this workspace and turn the shared vaults' keys?`
      : `Remove ${display} from this workspace?`;
    if (typeof window !== "undefined" && !window.confirm(ask)) return;
    startTransition(async () => {
      const result = await actions.remove(member.userId, rotate);
      setMessage({
        kind: result.ok ? "ok" : "err",
        text: result.message ?? (result.ok ? "Removed." : "Couldn’t remove."),
      });
    });
  }

  return (
    <>
      <tr>
        <td>
          <div className="wz-rosterWho">
            <span className="wz-rosterAvatar" aria-hidden="true">
              {(displayName(member)[0] ?? "?").toUpperCase()}
            </span>
            <div className="wz-rosterName">
              <span className="wz-rosterNamePrimary">
                {displayName(member)}
                {member.isYou ? <span className="wz-rosterYou">You</span> : null}
              </span>
              {member.email && displayName(member) !== member.email ? (
                <span className="wz-rosterNameSecondary">{member.email}</span>
              ) : null}
            </div>
          </div>
        </td>
        <td>
          {canManage ? (
            <select
              className="wz-rosterSelect"
              value={member.role}
              onChange={handleChangeRole}
              disabled={pending}
              aria-label={`Role for ${displayName(member)}`}
            >
              {roleOptions.map((o) => (
                <option key={o.role} value={o.role}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="wz-rolePill">{member.roleLabel}</span>
          )}
        </td>
        <td className="wz-rosterDate">{formatJoined(member.joinedAt)}</td>
        <td>
          {canManage ? (
            <div className="wz-rosterRemove">
              <label className="wz-rosterRotate">
                <input type="checkbox" checked={rotate} onChange={(e) => setRotate(e.target.checked)} disabled={pending} />
                Rotate shared vaults
              </label>
              <button
                type="button"
                className="wz-rosterButton wz-rosterButtonDanger"
                onClick={handleRemove}
                disabled={pending || member.isYou}
                aria-label={`Remove ${displayName(member)}`}
                title={member.isYou ? "You can’t remove yourself; use Leave instead" : `Remove ${displayName(member)}`}
              >
                {pending ? "Working…" : "Remove"}
              </button>
            </div>
          ) : (
            <span className="wz-rosterDash">—</span>
          )}
        </td>
      </tr>
      {message ? (
        <tr>
          <td colSpan={4}>
            <p className={`wz-rosterMessage ${message.kind === "err" ? "wz-rosterMessageError" : "wz-rosterMessageOk"}`}>
              {message.text}
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function Roster({
  members,
  canManage,
  roleOptions,
  currentUserId,
  actions,
}: {
  members: TeamMember[];
  canManage: boolean;
  roleOptions: RoleOption[];
  currentUserId: string;
  actions: TeamClientActions;
}) {
  // RosterMember is the row shape the page builds; TeamMember from
  // lib/team-types is what callers pass in (a snapshot's members list). The
  // page computes isYou against currentUserId; the component only needs the
  // precomputed flag, but it derives one here too so callers can hand in a
  // raw snapshot without pre-processing.
  const rows: RosterMember[] = members.map((m) =>
    RosterMemberProps(m, m.userId === currentUserId, roleLabelOf(m.role, roleOptions)),
  );
  if (rows.length === 0) {
    return <p className="wz-teamSub">No members yet. Invite the first teammate below.</p>;
  }

  return (
    <table className="wz-roster">
      <thead>
        <tr>
          <th scope="col">Member</th>
          <th scope="col">Role</th>
          <th scope="col">Joined</th>
          <th scope="col" aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <RosterRow
            key={m.userId}
            member={m}
            // A manager can't remove themselves — Leave workspace is the path off the roster.
            canManage={canManage && m.userId !== currentUserId}
            roleOptions={roleOptions}
            actions={actions}
          />
        ))}
      </tbody>
    </table>
  );
}
