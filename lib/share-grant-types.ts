// Sharing a card with people by GitHub account (docs/architecture/sharing.md#people). The contract between
// the Share dialog's People field and the composer's @ picker (the board), the Mac's routes
// (app/api/cards/[id]/share/grants, app/api/github/users), and weft.zip's notify route (app/api/s/[id]/grants/notify).
// A grant is one public.cloud_share_grants row: the share, a GitHub id (never just a login: logins get renamed and
// re-registered), the login to show, and how the owner named them.

// GitHub's own rule: 1 to 39 letters, digits or hyphens, not starting with a hyphen.
export const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function isGithubLogin(value: unknown): value is string {
  return typeof value === "string" && GITHUB_LOGIN_RE.test(value);
}

export type GrantVia = "share" | "mention";

export interface ShareGrant {
  githubId: number;
  login: string;
  via: GrantVia;
  createdAt: string;
  // When weft.zip emailed them, or null: no address known (the owner sends the link), or not sent yet.
  notifiedAt: string | null;
  // When they first got in through the gate.
  openedAt: string | null;
}

// How a new grant reached its person: an email went out, no address is known (tell the owner to send the link),
// or the email couldn't be sent (weft.zip has no mailer, or it failed).
export type GrantNotice = "emailed" | "no-email" | "not-sent";

// GET /api/cards/[id]/share/grants: the share's people, or null shareId when the card has no share row yet.
export interface ShareGrantsState {
  shareId: string | null;
  grants: ShareGrant[];
}

// POST /api/cards/[id]/share/grants { logins, via, note? }: one result per login, in order.
export type GrantOutcome = { login: string; ok: true; grant: ShareGrant; notice: GrantNotice } | { login: string; ok: false; error: string };

export interface GrantRequest {
  logins: string[];
  via: GrantVia;
  // The mention's message, quoted in the email (redacted and cut on weft.zip).
  note?: string;
}

// A person the pickers offer. `team`: in the card's workspace already (a private link lets them in, no grant).
// `repo`: a collaborator on the card's repo. `github`: a search hit.
export interface PersonHit {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  kind: "team" | "repo" | "github";
}

// The @logins a message mentions, in order, once each, lowercased for comparing. An @ inside a word (an email
// address) or a code span doesn't count.
export function mentionsIn(text: string): string[] {
  const plain = text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  const seen = new Set<string>();
  for (const m of plain.matchAll(/(^|[^\w@./-])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(?![\w-])/g)) {
    const login = (m[2] as string).toLowerCase();
    seen.add(login);
  }
  return [...seen];
}

// The mentioned logins that would need a grant: GitHub people, not already granted, not in the team.
export function ungrantedMentions(text: string, granted: readonly string[], team: readonly string[]): string[] {
  const skip = new Set([...granted, ...team].map((l) => l.toLowerCase()));
  return mentionsIn(text).filter((l) => !skip.has(l));
}

// The note quoted in a mention's email: one paragraph, at most NOTE_MAX characters.
export const NOTE_MAX = 280;

export function clipNote(note: unknown): string | null {
  if (typeof note !== "string") return null;
  const flat = note.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > NOTE_MAX ? `${flat.slice(0, NOTE_MAX - 1).trimEnd()}…` : flat;
}
