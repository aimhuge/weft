// A connector grant on a Weft Worker (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built): your
// approval for one worker to use one connector (GitHub, as you with Weft), with its settings. Shared by weft.zip's
// minter (lib/connector-mint.ts), Electron main's Touch ID path (electron/connector-grants.cjs keeps its own copy of
// LIFETIMES and looser, held to these by a test) and Settings → Devices. Pure: no I/O, safe in client code.

export const CONNECTORS = ["github"] as const;
export type Connector = (typeof CONNECTORS)[number];

// Which repos a minted token may reach. "installed": a user token, every repo the Weft app is installed on that you can
// reach. "project" and "card": a token narrowed to the card's one repo, still as you (GitHub's scoped user token).
export const SCOPES = ["installed", "project", "card"] as const;
export type Scope = (typeof SCOPES)[number];

// Who must have said yes before a card gets a token: the worker's grant alone, or also an Allow for its project or card.
export const APPROVALS = ["worker", "project", "card"] as const;
export type Approval = (typeof APPROVALS)[number];

// How long the grant itself lasts. Tokens are always short whatever this says.
export const LIFETIMES = ["revoked", "24h", "8h"] as const;
export type Lifetime = (typeof LIFETIMES)[number];

// The irreversible actions that ask. Deleting a repo isn't one: the Weft app has no administration permission.
export const ASKS = ["protected_push"] as const;
export type Ask = (typeof ASKS)[number];

export interface GrantSettings {
  scope: Scope;
  approval: Approval;
  lifetime: Lifetime;
  asks: Ask[];
}

export const DEFAULT_SETTINGS: GrantSettings = { scope: "installed", approval: "worker", lifetime: "revoked", asks: ["protected_push"] };

export const LIFETIME_MS: Record<Lifetime, number | null> = { revoked: null, "24h": 24 * 3_600_000, "8h": 8 * 3_600_000 };

// Each choice's words, for the worker's Connectors menu.
export const SCOPE_LABEL: Record<Scope, string> = { installed: "All installed repos", project: "This project's repo", card: "The card's repo" };
export const APPROVAL_LABEL: Record<Approval, string> = { worker: "Once per worker", project: "Per project", card: "Per card" };
export const LIFETIME_LABEL: Record<Lifetime, string> = { revoked: "Until revoked", "24h": "24 hours", "8h": "8 hours" };
export const ASK_LABEL: Record<Ask, string> = { protected_push: "Push to a protected branch" };

const pick = <T extends string>(list: readonly T[], value: unknown, fallback: T): T => (list.includes(value as T) ? (value as T) : fallback);

// Settings from anything (a row, a request body), with each unknown value replaced by its default.
export function settingsOf(raw: unknown): GrantSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const asks = Array.isArray(r.asks) ? r.asks.filter((a): a is Ask => ASKS.includes(a as Ask)) : DEFAULT_SETTINGS.asks;
  return {
    scope: pick(SCOPES, r.scope, DEFAULT_SETTINGS.scope),
    approval: pick(APPROVALS, r.approval, DEFAULT_SETTINGS.approval),
    lifetime: pick(LIFETIMES, r.lifetime, DEFAULT_SETTINGS.lifetime),
    asks: [...new Set(asks)],
  };
}

// Whether a change gives a card more than before: a wider scope, a weaker approval, a longer lifetime or one ask fewer.
// A looser change needs Touch ID, as turning the connector on does; a stricter one doesn't.
export function looser(was: GrantSettings, next: GrantSettings): boolean {
  const rank = <T extends string>(list: readonly T[], v: T) => list.indexOf(v);
  const life = (l: Lifetime) => LIFETIME_MS[l] ?? Number.POSITIVE_INFINITY;
  return (
    rank(SCOPES, next.scope) < rank(SCOPES, was.scope) ||
    rank(APPROVALS, next.approval) < rank(APPROVALS, was.approval) ||
    life(next.lifetime) > life(was.lifetime) ||
    was.asks.some((a) => !next.asks.includes(a))
  );
}

// When a grant set now with this lifetime ends, or null for until revoked.
export function expiryOf(lifetime: Lifetime, now: number): string | null {
  const ms = LIFETIME_MS[lifetime];
  return ms === null ? null : new Date(now + ms).toISOString();
}

export const isLive = (expiresAt: string | null | undefined, now: number) => !expiresAt || Date.parse(expiresAt) > now;

// The subject an Allow names under per-project or per-card approval, or null when the worker's grant is enough.
export function allowSubject(approval: Approval, card: { id: string; repo: string }): { kind: "project" | "card"; subject: string } | null {
  if (approval === "worker") return null;
  return approval === "project" ? { kind: "project", subject: card.repo } : { kind: "card", subject: card.id };
}

// What a worker signs to ask weft.zip for a token (lib/connector-client.ts signs, lib/connector-auth.ts checks), with
// its pairing sign key: every field the minter acts on, so a request can't be changed on the way or replayed elsewhere.
export interface MintRequest {
  workerId: string;
  cardId: string;
  connector: Connector;
  repo: string;
  ts: number;
  nonce: string;
}

export const mintMessage = (r: MintRequest) => JSON.stringify(["weft-connector-mint-v1", r.workerId, r.cardId, r.connector, r.repo, r.ts, r.nonce]);

export const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

// How long a minted token is handed out for, though GitHub's own life for it is 8 hours: it's handed out with
// `expiresAt = issued + ROTATE_MS`. Every holder stops using it HOLD_MARGIN_MS before that, and weft.zip replaces it
// (refreshing kills the old one) only once that margin has begun, so a rotation never kills a token a worker trusts.
export const ROTATE_MS = 60 * 60_000;
export const HOLD_MARGIN_MS = 2 * 60_000;

// Whether a token issued at `issuedAt` may still be handed out, or must be replaced first.
export const reusable = (issuedAt: number, now: number) => now < issuedAt + ROTATE_MS - HOLD_MARGIN_MS;
