"use client";

// Settings → Teams' "Your teams": every team you're in, one row each with your role, the one on screen
// marked; a row switches to it, a team you own has a pencil that renames it in place and, while you're in
// another team too, a trash that deletes it (after you type its name), and "+ New team" at the foot opens the
// name field. Replaced the switcher's <select>, which hid all but the current team.
import { useState } from "react";
import type { GithubOrg } from "@/lib/github-orgs";
import type { TeamClientActions, TeamOrg, TeamRole } from "@/lib/team-types";
import Icon, { Spinner } from "../Icon";
import { DeleteTeamForm } from "./DeleteTeamForm";
import { NewTeamForm, TeamNameForm } from "./NewTeamForm";

const ROW = "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left";
const ROW_ICON =
  "relative z-10 shrink-0 rounded-md p-1 text-muted opacity-0 hover:bg-sunken focus-visible:opacity-100 group-hover:opacity-100";

function TeamInitial({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[14px] font-semibold text-accent"
    >
      {name.trim().charAt(0).toUpperCase() || "W"}
    </span>
  );
}

// The current row's mark: a spinner while its team loads after a switch.
function Viewing({ loading }: { loading: boolean }) {
  return loading ? <Spinner size={12} /> : <>Viewing</>;
}

// One team. The name's button stretches over the whole row (its ::after), so a click anywhere switches;
// the pencil and trash sit above it.
function TeamRow({
  org,
  on,
  loading,
  roleLabels,
  onSwitch,
  onHover,
  onRename,
  onDelete,
}: {
  org: TeamOrg;
  on: boolean;
  loading: boolean;
  roleLabels: Record<TeamRole, string>;
  onSwitch: () => void;
  onHover?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  return (
    <li className={`group relative ${ROW} ${on ? "bg-accent-soft ring-1 ring-accent/40" : "hover:bg-sunken"}`}>
      <TeamInitial name={org.name} />
      <button
        type="button"
        aria-current={on ? "true" : undefined}
        onClick={() => {
          if (!on) onSwitch();
        }}
        onMouseEnter={onHover}
        className="min-w-0 truncate text-left text-[14px] font-medium text-ink outline-none after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-accent"
      >
        {org.name}
      </button>
      {onRename ? (
        <button
          type="button"
          aria-label={`Rename ${org.name}`}
          onClick={onRename}
          className={`${ROW_ICON} hover:text-ink`}
        >
          <Icon name="pencil" size={13} />
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" aria-label={`Delete ${org.name}`} onClick={onDelete} className={`${ROW_ICON} hover:text-danger`}>
          <Icon name="trash" size={13} />
        </button>
      ) : null}
      <span className="flex-1" />
      {org.role ? <span className="rounded-full border border-line-strong px-2 py-px text-[11px] text-muted">{roleLabels[org.role]}</span> : null}
      <span className="flex w-16 justify-end text-[11.5px] text-accent">{on ? <Viewing loading={loading} /> : null}</span>
    </li>
  );
}

export function TeamList({
  orgs,
  current,
  loading,
  roleLabels,
  actions,
  onSwitch,
  onHover,
  githubOrgs,
}: {
  orgs: TeamOrg[];
  current: string | undefined;
  // True while `current` is still loading after a switch.
  loading: boolean;
  roleLabels: Record<TeamRole, string>;
  actions: TeamClientActions;
  onSwitch: (slug: string) => void;
  onHover?: (slug: string) => void;
  // Your GitHub orgs, offered as names for a new team (lib/use-github-orgs.ts).
  githubOrgs?: GithubOrg[];
}) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Delete is only offered while you'd still be in a team afterwards.
  const canDelete = (o: TeamOrg) => o.role === "owner" && orgs.length > 1;
  // Deleting the team on screen moves the page to another one first.
  const afterDelete = (slug: string) => {
    setDeleting(null);
    const next = orgs.find((o) => o.slug !== slug);
    if (slug === current && next) onSwitch(next.slug);
  };

  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1" aria-label="Your teams">
        {orgs.map((o) =>
          deleting === o.slug ? (
            <li key={o.slug}>
              <DeleteTeamForm
                org={o}
                submit={(confirm) => actions.deleteTeam(o.slug, confirm)}
                onDone={() => afterDelete(o.slug)}
                onCancel={() => setDeleting(null)}
              />
            </li>
          ) : renaming === o.slug ? (
            <li key={o.slug} className={ROW}>
              <TeamInitial name={o.name} />
              <TeamNameForm
                initial={o.name}
                submitLabel="Rename"
                busyLabel="Renaming…"
                failed="Couldn't rename the team."
                submit={(name) => actions.renameTeam(o.slug, name)}
                onDone={() => setRenaming(null)}
                onCancel={() => setRenaming(null)}
              />
            </li>
          ) : (
            <TeamRow
              key={o.slug}
              org={o}
              on={o.slug === current}
              loading={loading}
              roleLabels={roleLabels}
              onSwitch={() => onSwitch(o.slug)}
              onHover={onHover ? () => onHover(o.slug) : undefined}
              onRename={o.role === "owner" ? () => setRenaming(o.slug) : undefined}
              onDelete={canDelete(o) ? () => setDeleting(o.slug) : undefined}
            />
          ),
        )}
      </ul>
      {creating ? (
        <div className="px-2.5 py-2">
          <NewTeamForm
            actions={actions}
            orgs={githubOrgs}
            onCancel={() => setCreating(false)}
            onCreated={(slug) => {
              setCreating(false);
              onSwitch(slug);
            }}
          />
        </div>
      ) : (
        <button type="button" onClick={() => setCreating(true)} className={`${ROW} text-[13px] text-muted hover:bg-sunken hover:text-ink`}>
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-dashed border-line-strong text-[15px]">
            +
          </span>
          New team
        </button>
      )}
    </div>
  );
}
