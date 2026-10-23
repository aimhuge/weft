"use client";

import { useState, type SubmitEvent } from "react";
import type { TeamClientActions, TeamRole, TeamSnapshot } from "@/lib/team-types";
import type { TeamHookState } from "@/lib/use-team";
import { Spinner } from "./Icon";
import { SHARE_BUTTON, ShareNote } from "./ShareParts";
import { track } from "@/lib/analytics";

// The body of Share the board, shared by the desktop (components/ShareBoardDialog.tsx, the team through lib/use-team.ts)
// and the weft.zip board (components/web-board/WebShareBoard.tsx, the team through lib/team-actions.ts): the workspace
// switcher, an email box, and who can open the board. The web board shows a workspace's synced cards to its members, so
// sharing the board is inviting someone to the workspace: weft.zip's team invite (lib/team-ops.ts runInvite) adds an
// address that already has a Weft account straight in, and emails an invite to one that doesn't, so they sign up and join.
export function boardUrl(slug: string): string {
  return `https://weft.zip/${slug}/board`;
}

const MUTED = "text-[12px] leading-snug text-muted";

// Member unless the viewer can't hand it out; Owner is too much to give by default.
function inviteRole(team: TeamSnapshot): TeamRole | undefined {
  const roles = team.roleOptions.map((o) => o.role);
  return roles.includes("member") ? "member" : roles[0];
}

// Loading, a load error with Try again, or the workspace's sharing panel.
export function BoardShareBody({
  state,
  refresh,
  actions,
  onSwitch,
  onManageTeam,
}: {
  state: Exclude<TeamHookState, { kind: "signed-out" }>;
  refresh: () => void;
  actions: TeamClientActions;
  onSwitch: (slug: string) => void;
  onManageTeam: () => void;
}) {
  if (state.kind === "loading")
    return (
      <ShareNote>
        <Spinner size={13} /> Loading your workspace…
      </ShareNote>
    );
  if (state.kind === "error")
    return (
      <div className="space-y-2">
        <p role="alert" className="text-[13px] text-danger">
          Couldn&apos;t load your workspace: {state.message}
        </p>
        <button type="button" className={SHARE_BUTTON} onClick={refresh}>
          Try again
        </button>
      </div>
    );
  return <BoardShare team={state.team} actions={actions} onSwitch={onSwitch} onManageTeam={onManageTeam} />;
}

function BoardShare({
  team,
  actions,
  onSwitch,
  onManageTeam,
}: {
  team: TeamSnapshot;
  actions: TeamClientActions;
  onSwitch: (slug: string) => void;
  onManageTeam: () => void;
}) {
  const role = inviteRole(team);
  return (
    <div className="space-y-4">
      {team.orgs.length > 1 && (
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          Workspace
          <select
            aria-label="Workspace"
            value={team.org.slug}
            onChange={(e) => onSwitch(e.target.value)}
            className="rounded-md border border-line-strong bg-canvas px-2 py-1 text-[12.5px] text-ink outline-none focus:border-accent"
          >
            {team.orgs.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {team.canManage && role ? (
        <InviteBox role={role} actions={actions} />
      ) : (
        <p className={MUTED}>Only the workspace&apos;s owners and admins can invite people. Teammates can already open the link.</p>
      )}
      <People team={team} />
      <p className={MUTED}>
        The link shows {team.org.name}&apos;s board to its members, live: cards from folders that sync (Settings → Sync). Someone without a
        Weft account gets an email to sign up and join.{" "}
        <button type="button" onClick={onManageTeam} className="text-accent underline">
          Manage the team
        </button>
      </p>
    </div>
  );
}

function InviteBox({ role, actions }: { role: TeamRole; actions: TeamClientActions }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const address = email.trim();
    if (!address || busy) return;
    setBusy(true);
    const answer = await actions.invite(address, role);
    setBusy(false);
    setResult(answer);
    if (answer.ok) {
      track("team_invite_sent", { role });
      setEmail("");
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-1.5">
      <div className="flex gap-2">
        <input
          type="email"
          aria-label="Email to invite"
          placeholder="Add people by email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          autoComplete="email"
          className="min-w-0 flex-1 rounded-md border border-line-strong bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
        />
        <button type="submit" disabled={busy || !email.trim()} className={SHARE_BUTTON}>
          {busy && <Spinner size={13} />} Invite
        </button>
      </div>
      {result?.message && (
        <p role={result.ok ? "status" : "alert"} className={`text-[12px] ${result.ok ? "text-ok" : "text-danger"}`}>
          {result.message}
        </p>
      )}
    </form>
  );
}

function Person({ initial, name, detail }: { initial: string; name: string; detail: string }) {
  return (
    <li className="flex items-center gap-2.5 py-1">
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-medium text-accent"
      >
        {initial}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{name}</span>
      <span className="shrink-0 text-[12px] text-muted">{detail}</span>
    </li>
  );
}

// Members first (you marked), then the invites still waiting on a sign-up.
function People({ team }: { team: TeamSnapshot }) {
  return (
    <div>
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">People with access</h4>
      <ul aria-label="People with access">
        {team.members.map((m) => {
          const name = m.name ?? m.email ?? "A teammate";
          const you = m.userId === team.user.id ? " · you" : "";
          return <Person key={m.userId} initial={name.charAt(0).toUpperCase()} name={name} detail={`${team.roleLabels[m.role]}${you}`} />;
        })}
        {team.pending.map((i) => (
          <Person key={i.id} initial="✉" name={i.email} detail="Invited" />
        ))}
      </ul>
    </div>
  );
}
