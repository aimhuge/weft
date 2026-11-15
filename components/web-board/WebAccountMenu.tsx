"use client";

// The avatar at the right end of the weft.zip board's header, where the desktop keeps its AccountButton: a menu with
// who's signed in, the workspaces to switch to (each opens that workspace's board), Team, Billing and Sign out, which
// is the same plain POST to /auth/sign-out the workspace sidebar uses (Sign out everywhere adds scope=global). The
// sidebar steps aside on the board, so this is where its parts went.
import { useRef, useState } from "react";
import { Check, CreditCard, LogOut, ShieldOff, Users } from "lucide-react";
import { EVERYWHERE_QUESTION } from "@/lib/sign-out-everywhere";
import type { TeamContext } from "@/lib/teams";
import { formatOrgLabel, orgInitial, useClickOutside, userDisplayName, userInitials } from "../team/WorkspaceHeader";

export type WebUser = TeamContext["user"];
export type WebOrg = TeamContext["orgs"][number];

const ITEM = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-sunken";

export function WebAccountMenu({ user, orgs, orgSlug }: { user: WebUser; orgs: readonly WebOrg[]; orgSlug: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useClickOutside(open, () => setOpen(false), wrap);
  const name = userDisplayName(user.name, user.email);

  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${name}`}
        title={user.email ?? name}
        className="grid size-7 place-items-center overflow-hidden rounded-full bg-accent text-[12px] font-semibold text-on-accent ring-1 ring-line-strong hover:opacity-90"
      >
        {user.avatar ? <img src={user.avatar} alt="" className="size-full object-cover" /> : userInitials(user.name, user.email)}
      </button>
      {open && (
        <div role="menu" onKeyDown={(e) => e.key === "Escape" && setOpen(false)} className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-lg border border-line-strong bg-panel p-1.5 shadow-2xl">
          <div className="px-2 pb-2 pt-1">
            <p className="truncate text-[13px] font-medium text-ink">{name}</p>
            {user.email && user.email !== name && <p className="truncate text-[11.5px] text-muted">{user.email}</p>}
          </div>
          <p className="border-t border-line px-2 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-wide text-faint">Workspaces</p>
          {orgs.map((org) => (
            <a key={org.id} role="menuitem" href={`/${org.slug}/board`} aria-current={org.slug === orgSlug ? "true" : undefined} className={ITEM}>
              <span aria-hidden className="grid size-5 place-items-center rounded bg-sunken text-[10.5px] font-semibold text-muted">{orgInitial(org)}</span>
              <span className="min-w-0 flex-1 truncate">{formatOrgLabel(org)}</span>
              {org.slug === orgSlug && <Check size={13} className="text-accent" aria-hidden />}
            </a>
          ))}
          <div className="mt-1 border-t border-line pt-1">
            <a role="menuitem" href={`/${orgSlug}/team`} className={ITEM}>
              <Users size={14} className="text-muted" aria-hidden /> Team
            </a>
            <a role="menuitem" href={`/${orgSlug}/billing`} className={ITEM}>
              <CreditCard size={14} className="text-muted" aria-hidden /> Billing
            </a>
            <form method="post" action="/auth/sign-out">
              <button type="submit" role="menuitem" className={ITEM}>
                <LogOut size={14} className="text-muted" aria-hidden /> Sign out
              </button>
            </form>
            <form
              method="post"
              action="/auth/sign-out"
              onSubmit={(e) => {
                if (!window.confirm(EVERYWHERE_QUESTION)) e.preventDefault();
              }}
            >
              <input type="hidden" name="scope" value="global" />
              <button type="submit" role="menuitem" className={ITEM}>
                <ShieldOff size={14} className="text-muted" aria-hidden /> Sign out everywhere
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
