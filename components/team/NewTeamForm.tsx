"use client";

// A team's name field with a submit and Cancel, inline in Settings → Teams' list: "New team" at its foot
// (NewTeamForm: actions.createTeam, then the caller switches to the new workspace's slug) and the pencil on a
// team you own (TeamNameForm with actions.renameTeam). New team offers your GitHub orgs above the name: picking one
// fills the name and makes the slug follow the org (weft.zip/<org>); the name stays editable, and typing a name
// with no org picked still makes a team.
import { useState, useTransition, type SubmitEvent } from "react";
import type { GithubOrg } from "@/lib/github-orgs";
import { TEAM_NAME_MAX, type NewTeamResult, type TeamClientActions } from "@/lib/team-types";

export function TeamNameForm({
  initial = "",
  cancelUnchanged = true,
  submitLabel,
  busyLabel,
  failed,
  submit,
  onDone,
  onCancel,
}: {
  initial?: string;
  // A rename left as it was just closes; a new team prefilled from an org still has to be made.
  cancelUnchanged?: boolean;
  submitLabel: string;
  busyLabel: string;
  // What to say when the answer has no message of its own.
  failed: string;
  submit: (name: string) => Promise<NewTeamResult>;
  onDone: (result: NewTeamResult) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const trimmed = name.trim();

  function send(e: SubmitEvent) {
    e.preventDefault();
    if (!trimmed) return;
    if (cancelUnchanged && trimmed === initial) {
      onCancel();
      return;
    }
    startTransition(async () => {
      const result = await submit(trimmed);
      if (result.ok) onDone(result);
      else setError(result.message ?? failed);
    });
  }

  return (
    <form onSubmit={send} className="flex min-w-0 flex-col gap-1" noValidate>
      <div className="flex items-center gap-2">
        <input
          aria-label="Team name"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={name}
          maxLength={TEAM_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              onCancel();
            }
          }}
          placeholder="Team name"
          className="w-48 min-w-0 rounded-md border border-line-strong bg-canvas px-2 py-1 text-[12.5px] text-ink outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending || !trimmed}
          className="rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50"
        >
          {pending ? busyLabel : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="text-[12.5px] text-muted hover:text-ink">
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function OrgPicks({ orgs, picked, onPick }: { orgs: GithubOrg[]; picked: string | null; onPick: (login: string | null) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted" role="group" aria-label="Your GitHub orgs">
      From GitHub:
      {orgs.map((o) => (
        <button
          key={o.login}
          type="button"
          aria-pressed={picked === o.login}
          onClick={() => onPick(picked === o.login ? null : o.login)}
          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-ink ${picked === o.login ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-sunken"}`}
        >
          {o.avatarUrl ? <img src={o.avatarUrl} alt="" width={14} height={14} className="rounded-sm" /> : null}
          {o.login}
        </button>
      ))}
    </div>
  );
}

export function NewTeamForm({
  actions,
  orgs = [],
  onCreated,
  onCancel,
}: {
  actions: TeamClientActions;
  orgs?: GithubOrg[];
  onCreated: (slug: string) => void;
  onCancel: () => void;
}) {
  const [org, setOrg] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      {orgs.length > 0 ? <OrgPicks orgs={orgs} picked={org} onPick={setOrg} /> : null}
      <TeamNameForm
        // A new pick refills the name; the field stays editable after it.
        key={org ?? ""}
        initial={org ?? ""}
        cancelUnchanged={false}
        submitLabel="Create"
        busyLabel="Creating…"
        failed="Couldn't create the team."
        // A yes without a slug leaves nothing to switch to, so it reads as a failure.
        submit={(name) => actions.createTeam(name, org ?? undefined).then((r) => (r.ok && !r.slug ? { ...r, ok: false } : r))}
        onDone={(r) => onCreated(r.slug ?? "")}
        onCancel={onCancel}
      />
    </div>
  );
}
