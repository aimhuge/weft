// The pure side of the share pickers (docs/architecture/sharing.md#people): which people to offer for a query, in what
// order, and what a granted person's chip says. Used by the Share dialog's People field (components/SharePeople.tsx)
// and the composer's @ picker (components/Composer.tsx).
import type { GrantNotice, PersonHit, ShareGrant } from "./share-grant-types";

export const PEOPLE_LIMIT = 8;

function matches(p: PersonHit, q: string): boolean {
  if (!q) return true;
  return p.login.toLowerCase().includes(q) || (p.name ?? "").toLowerCase().includes(q);
}

// Team first (already in on a private link), then the repo's people, then GitHub's hits; each login once, a login
// that starts with the query ahead of one that only contains it, at most `limit`.
export function mergePeople(query: string, groups: { team?: PersonHit[]; suggested?: PersonHit[]; found?: PersonHit[] }, limit = PEOPLE_LIMIT): PersonHit[] {
  const q = query.trim().replace(/^@/, "").toLowerCase();
  const seen = new Set<string>();
  const out: PersonHit[] = [];
  const local = [...(groups.team ?? []), ...(groups.suggested ?? [])].filter((p) => matches(p, q));
  local.sort((a, b) => Number(b.login.toLowerCase().startsWith(q)) - Number(a.login.toLowerCase().startsWith(q)));
  for (const p of [...local, ...(groups.found ?? [])]) {
    const key = p.login.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

export function agoText(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export type ChipTone = "ok" | "warn" | "muted";

// What a granted person's chip says: they opened it (the loop closed), we emailed them, or the owner has to send the
// link themselves. `notice` is this session's answer for a grant just made; an older grant reads from its stamps.
export function grantStatus(grant: ShareGrant, notice?: GrantNotice, now = Date.now()): { text: string; tone: ChipTone } {
  if (grant.openedAt) return { text: `opened ${agoText(grant.openedAt, now)}`, tone: "ok" };
  if (grant.notifiedAt || notice === "emailed") return { text: "emailed", tone: "muted" };
  if (notice === "not-sent") return { text: "couldn't email · send them the link", tone: "warn" };
  return { text: "no email on file · send them the link", tone: "warn" };
}

// The hint under a picker row: what picking this person does.
export function pickHint(p: PersonHit, shared: boolean): string {
  if (p.kind === "team") return "in your workspace";
  const where = p.kind === "repo" ? "on this repo" : "GitHub";
  return shared ? `${where} · can get access to the share` : where;
}
