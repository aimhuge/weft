"use client";

// The sidebar down the left of every /[orgSlug]/* page on weft.zip (a top bar
// on a phone): the Weft mark, the workspace (a switcher when the user belongs
// to more than one), the Board / Team / Billing nav with the current page lit,
// and at the foot the signed-in identity with a Sign-out form that posts to
// /auth/sign-out (a same-origin cookie round trip, no JS needed). The class
// names keep their wz-workspaceHeader prefix from when this was a thin strip.
//
// The switcher uses the same dropdown pattern as components/TagsDrawer and
// the existing AccountButton: a button that toggles aria-expanded, click-
// outside to dismiss, Escape to close, and the list of workspaces as <a>
// links so the browser does the navigation (and middle-click / right-click
// work). The current workspace is marked with aria-current="true".
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronsUpDown, CreditCard, LayoutGrid, LogOut, Users } from "lucide-react";
import type { TeamContext } from "@/lib/teams";

// What the header needs from the gate: everything but the service-role client, which must never reach the browser.
export type HeaderContext = Omit<TeamContext, "service">;

export function userInitials(name: string | null, email: string | null): string {
  const seed = (name?.trim() || email?.split("@")[0] || "?").trim();
  return (seed[0] ?? "?").toUpperCase();
}

export function userDisplayName(name: string | null, email: string | null): string {
  return name?.trim() || email || "Signed in";
}

export function formatOrgLabel(org: TeamContext["orgs"][number]): string {
  return org.name.trim() || org.slug;
}

export function orgInitial(org: TeamContext["orgs"][number]): string {
  return (formatOrgLabel(org)[0] ?? "?").toUpperCase();
}

export function useClickOutside(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose, ref]);
}

function WorkspaceSwitcher({ ctx }: { ctx: HeaderContext }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(open, () => setOpen(false), wrapRef);

  // No switcher when the user is in a single workspace: the toggle would be
  // a dead end. Sorted oldest-first (the team-actions contract on listUserOrgs),
  // so the dropdown's order matches the order they joined.
  if (ctx.orgs.length <= 1) {
    return (
      <div className="wz-workspaceSwitcher">
        <div className="wz-workspaceBrand">
          <span className="wz-workspaceMark" aria-hidden="true">{orgInitial(ctx.org)}</span>
          <span className="wz-workspaceLabel">{formatOrgLabel(ctx.org)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="wz-workspaceSwitcher" ref={wrapRef}>
      <button
        type="button"
        className="wz-workspaceSwitcherButton"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Switch workspace (currently ${formatOrgLabel(ctx.org)})`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            e.currentTarget.focus();
          }
        }}
      >
        <span className="wz-workspaceMark" aria-hidden="true">{orgInitial(ctx.org)}</span>
        <span className="wz-workspaceLabel">{formatOrgLabel(ctx.org)}</span>
        <ChevronsUpDown className="wz-workspaceSwitcherCaret" aria-hidden="true" />
      </button>
      {open ? (
        <div className="wz-workspaceSwitcherMenu" role="menu">
          {ctx.orgs.map((o) => {
            const isCurrent = o.id === ctx.org.id;
            return (
              <a
                key={o.id}
                role="menuitem"
                href={`/${o.slug}/team`}
                className="wz-workspaceSwitcherItem"
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => setOpen(false)}
              >
                <span className="wz-workspaceMark wz-workspaceMarkSm" aria-hidden="true">{orgInitial(o)}</span>
                <span className="wz-workspaceLabel">{formatOrgLabel(o)}</span>
                {isCurrent ? <Check className="wz-workspaceSwitcherCheck" aria-hidden="true" /> : null}
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

type Section = "team" | "billing" | "board" | "other";

// The layout doesn't know the segment, so the sidebar reads it off the URL; a page may still pass it.
function sectionOf(pathname: string | null): Section {
  const segment = pathname?.split("/")[2];
  return segment === "board" || segment === "team" || segment === "billing" ? segment : "other";
}

const NAV = [
  { id: "board", label: "Board", Icon: LayoutGrid },
  { id: "team", label: "Team", Icon: Users },
  { id: "billing", label: "Billing", Icon: CreditCard },
] as const;

function WorkspaceNav({ orgSlug, current }: { orgSlug: string; current: Section }) {
  return (
    <nav className="wz-workspaceNav" aria-label="Workspace sections">
      {NAV.map(({ id, label, Icon }) => (
        <a
          key={id}
          className="wz-workspaceNavLink"
          href={`/${orgSlug}/${id}`}
          aria-current={current === id ? "page" : undefined}
        >
          <Icon className="wz-workspaceNavIcon" aria-hidden="true" />
          {label}
        </a>
      ))}
    </nav>
  );
}

function WorkspaceUser({ user }: { user: TeamContext["user"] }) {
  const display = userDisplayName(user.name, user.email);
  return (
    <span className="wz-workspaceUser" title={user.email ?? display}>
      <span className="wz-workspaceUserAvatar" aria-hidden="true">
        {user.avatar ? <img src={user.avatar} alt="" /> : userInitials(user.name, user.email)}
      </span>
      <span className="wz-workspaceUserText">
        <span className="wz-workspaceUserName">{display}</span>
        {user.email && user.email !== display ? <span className="wz-workspaceUserEmail">{user.email}</span> : null}
      </span>
    </span>
  );
}

function WeaveMark() {
  return (
    <svg className="wz-workspaceMarkSvg" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="wz-mark-bg" x1="0" y1="0" x2="0" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2c3756" />
          <stop offset="1" stopColor="#171d31" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#wz-mark-bg)" />
      <rect x="5" y="12" width="22" height="3.5" rx="1.75" fill="#da7a4c" />
      <rect x="5" y="19" width="22" height="3.5" rx="1.75" fill="#8f98b3" />
      <rect x="11" y="5" width="3.5" height="22" rx="1.75" fill="#ece5d8" />
      <rect x="18" y="5" width="3.5" height="22" rx="1.75" fill="#ece5d8" opacity="0.7" />
    </svg>
  );
}

export function WorkspaceHeader({ ctx, current }: { ctx: HeaderContext; current?: Section }) {
  const pathname = usePathname();
  const section = current ?? sectionOf(pathname);
  // The board draws the desktop's own chrome (components/BoardHeader.tsx and components/web-board/WebRail.tsx) instead.
  if (section === "board") return null;
  return (
    <aside className="wz-workspaceHeader">
      <Link className="wz-workspaceHome" href="/" aria-label="Weft home">
        <WeaveMark />
        <span className="wz-workspaceWordmark">Weft</span>
      </Link>
      <WorkspaceSwitcher ctx={ctx} />
      <WorkspaceNav orgSlug={ctx.org.slug} current={section} />
      <div className="wz-workspaceFoot">
        <WorkspaceUser user={ctx.user} />
        {/* Plain POST form to /auth/sign-out: the route signs the visitor out
            and 303s to /login. No JS required. */}
        <form method="post" action="/auth/sign-out">
          <button type="submit" className="wz-workspaceSignOut" title="Sign out">
            <LogOut className="wz-workspaceSignOutIcon" aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
