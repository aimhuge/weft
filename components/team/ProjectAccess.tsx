"use client";

// Who may see one team project, for those who manage the team: an "Access" toggle on the project's row that opens
// a checklist of the team's members. Owners and admins see every project, so only plain members are listed; a tick
// grants, an untick takes it away (lib/team-project-access.ts). Folded into the row so the list stays one line each.
import { useState, useTransition } from "react";
import type { TeamClientActions, TeamMember, TeamProject } from "@/lib/team-types";

const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";

// "2 of 3 members", the toggle's label; the members are the ones a grant applies to.
export function accessLabel(granted: number, members: number): string {
  return `Access · ${granted} of ${members}`;
}

function MemberToggle({ member, checked, onChange, busy }: { member: TeamMember; checked: boolean; onChange: (on: boolean) => void; busy: boolean }) {
  const who = member.name ?? member.email ?? "Unnamed member";
  return (
    <li>
      <label className="flex items-center gap-2 py-0.5 text-[12.5px] text-ink">
        <input type="checkbox" checked={checked} disabled={busy} onChange={(e) => onChange(e.target.checked)} />
        <span className="truncate">{who}</span>
        {member.name && member.email ? <span className="truncate text-muted">{member.email}</span> : null}
      </label>
    </li>
  );
}

export function ProjectAccess({ project, members, actions }: { project: TeamProject; members: TeamMember[]; actions: TeamClientActions }) {
  const plain = members.filter((m) => m.role === "member");
  const [open, setOpen] = useState(false);
  // Ticks show at once; a refused change puts the box back and says why.
  const [granted, setGranted] = useState(() => new Set(project.access));
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  if (plain.length === 0) return null;
  const count = plain.filter((m) => granted.has(m.userId)).length;

  function toggle(userId: string, on: boolean) {
    const before = new Set(granted);
    const next = new Set(granted);
    if (on) next.add(userId);
    else next.delete(userId);
    setGranted(next);
    startTransition(async () => {
      const result = await actions.setProjectAccess(project.repo, userId, on);
      if (result.ok) setError(null);
      else {
        setGranted(before);
        setError(result.message ?? "Couldn't change access.");
      }
    });
  }

  return (
    <>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={BUTTON}>
        {accessLabel(count, plain.length)}
      </button>
      {open ? (
        <div className="order-last basis-full rounded-md border border-line bg-sunken px-2.5 py-1.5" aria-label={`Who can see ${project.repo}`} role="group">
          <ul>
            {plain.map((m) => (
              <MemberToggle key={m.userId} member={m} checked={granted.has(m.userId)} busy={busy} onChange={(on) => toggle(m.userId, on)} />
            ))}
          </ul>
          <p className="mt-1 text-[12px] text-muted">Owners and admins see every project.</p>
          {error ? (
            <p role="alert" className="text-[12.5px] text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
