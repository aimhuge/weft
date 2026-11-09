"use client";

// The invite-a-teammate form on the Team page. A single email + role pair
// goes through actions.invite, which returns { ok, message }.
//
// The role <select> shows the actor's assignable roles (server-filtered
// before the form is rendered), and the description of whichever role is
// currently picked shows underneath so the inviter doesn't have to guess.
// On submit the action runs, the message renders inline (red on !ok,
// green on ok), and on success the email field is cleared (the role
// sticks so a second invite reuses it).
//
// The actions object comes in as a prop (lib/team-types.ts's
// TeamClientActions) so this component is shared by the weft.zip server
// page and the desktop's Settings → Team. useTransition owns the pending
// state — onSubmit + e.preventDefault() because React 19 resets a form
// after its <form action>, which would throw away the picked role along
// with the email.
import { useState, useTransition, type SubmitEvent } from "react";
import type { RoleOption as RoleOptionBase, TeamClientActions, TeamRole } from "@/lib/team-types";
import { track } from "@/lib/analytics";

export type RoleOption = RoleOptionBase;

export type InviteActionState = { ok: boolean; message?: string };

// "@ada" or "ada" (no @ sign of an email) is a GitHub login, when the page can look one up.
export function typedLogin(value: string): string | null {
  const v = value.trim();
  if (!v || v.includes(" ")) return null;
  if (v.startsWith("@")) return v.slice(1) || null;
  return v.includes("@") ? null : v;
}

export function InviteForm({
  roleOptions,
  defaultRole,
  actions,
  resolveLogin,
}: {
  roleOptions: RoleOption[];
  defaultRole?: TeamRole;
  actions: TeamClientActions;
  // The desktop looks a GitHub login's public email up through gh, so you can invite by @login; the web can't.
  resolveLogin?: (login: string) => Promise<string | null>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>(defaultRole ?? roleOptions[0]?.role ?? "member");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<InviteActionState>({ ok: false });

  function handleSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    const login = resolveLogin ? typedLogin(trimmed) : null;
    startTransition(async () => {
      const to = login && resolveLogin ? await resolveLogin(login) : trimmed;
      if (!to) {
        setMessage({ ok: false, message: `@${login} hides their email on GitHub. Type their email instead.` });
        return;
      }
      const result = await actions.invite(to, role);
      setMessage({ ok: result.ok, message: result.message });
      if (result.ok) {
        track("team_invite_sent", { role });
        setEmail("");
      }
    });
  }

  const currentRole = roleOptions.find((o) => o.role === role) ?? roleOptions[0];
  const text = message.message;

  return (
    <form onSubmit={handleSubmit} className="wz-inviteForm" noValidate>
      <div className="wz-inviteRow">
        <div className="wz-inviteField">
          <label htmlFor="invite-email">{resolveLogin ? "Email or @GitHub login" : "Email"}</label>
          <input
            id="invite-email"
            name="email"
            type={resolveLogin ? "text" : "email"}
            className="wz-inviteInput"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={resolveLogin ? "@login or teammate@example.com" : "teammate@example.com"}
            autoComplete="email"
            required
            disabled={pending}
          />
        </div>
        <div className="wz-inviteField" style={{ flex: "0 0 180px" }}>
          <label htmlFor="invite-role">Role</label>
          <select
            id="invite-role"
            name="role"
            className="wz-inviteSelect"
            value={role}
            onChange={(e) => setRole(e.target.value as TeamRole)}
            disabled={pending || roleOptions.length === 0}
            aria-describedby="invite-role-description"
          >
            {roleOptions.map((o) => (
              <option key={o.role} value={o.role}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {currentRole ? (
        <p id="invite-role-description" className="wz-inviteRoleDescription">
          {currentRole.description}
        </p>
      ) : null}
      <div>
        <button type="submit" className="wz-inviteSubmit" disabled={pending || !email.trim()}>
          {pending ? "Sending…" : "Send invite"}
        </button>
      </div>
      {text ? (
        <p
          className={`wz-inviteMessage ${message.ok ? "wz-inviteMessageOk" : "wz-inviteMessageError"}`}
          role={message.ok ? "status" : "alert"}
        >
          {text}
        </p>
      ) : null}
    </form>
  );
}
