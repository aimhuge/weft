// The 🔐 drawer's Event log tab: the shared vault's audit trail (docs/architecture/teams-vault.md,
// "What the 🔐 drawer shows" and Q14). Who did what, never a value: the server's `vault_events` rows
// carry an action, a target name and an environment, and nothing else worth showing.
//
// The contract between the board and Electron main is `bridge.events(vaultId, { since, scope })`.
// The drawer asks for the last hundred rows of one vault; main reads them through the signed-in
// user's Supabase client, so RLS scopes them to the members of the vault's org.
//
// A value never crosses this boundary: the handler selects named columns only (never `metadata`,
// which is writer-controlled jsonb), and the row that reaches the renderer has a fixed shape.

export type VaultEventScope = "mine" | "all";

// How many rows the tab holds. The doc's "last 100 vault_events for this vault".
export const EVENTS_LIMIT = 100;

// One row of the event log, as the renderer sees it. Every field is named and every field is
// metadata about the action — no value, no ciphertext, no key.
export interface VaultEvent {
  id: string;
  // The action as the server wrote it, e.g. "set", "add blank", "remove".
  action: string;
  // The secret's name, when the action named one.
  targetName: string | null;
  // The environment, when the action named one.
  targetEnvironment: string | null;
  // Who did it: the user's id (null for a system event) and their email, denormalized so the row
  // survives the user being deleted.
  actorUserId: string | null;
  actorEmail: string | null;
  // When it happened (ISO 8601).
  createdAt: string;
}

// What `bridge.events` answers.
export interface VaultEventsResult {
  events: VaultEvent[];
  // The oldest row's timestamp, for the next page's `since`. Null when the list is empty.
  since: string | null;
  // The signed-in user's id, so the renderer can check the live feed's rows against the "mine"
  // filter itself. An id, not a secret: main reads it from the user's own token.
  userId?: string | null;
  // Whether the vault is shared with a workspace at all. A vault that isn't has no event log.
  shared?: boolean;
}

// The call itself. `since` is a timestamp: only rows created after it. `scope` is "mine" (the
// current user's own actions, the default) or "all" (every member's, the team's view).
export interface VaultEventsQuery {
  since?: string | null;
  scope?: VaultEventScope;
}

// The bridge's shape for the tab. Missing in a shell from before the tab.
export interface VaultEventsBridge {
  events(vaultId: string, query?: VaultEventsQuery): Promise<VaultEventsResult>;
  // A teammate's action landed: the board reloads the log. Missing in older shells.
  onEvents?(callback: (vaultId: string) => void): () => void;
}

// What the shell's preload exposes for the tab (electron/preload.cjs): the log, the live feed and
// the row that lands. The live feed's rows come as the server's own columns, so the renderer maps
// them with `toVaultEvents`.
export interface VaultEventsShell {
  events(vaultId: string, query?: VaultEventsQuery): Promise<VaultEventsResult>;
  watchEvents?(vaultId: string, scope: VaultEventScope): Promise<unknown>;
  unwatchEvents?(vaultId: string): Promise<unknown>;
  onEvents?(callback: (payload: { vaultId: string; rows: Record<string, unknown>[] }) => void): () => void;
}

// The tab's part of the shell's vault bridge, or null when the shell is too old to have it. The
// vault bridge's own type (lib/vault-view.ts) doesn't name the event log's calls, so they are read
// off the window here, where the cast is one narrow place.
export function vaultEventsBridge(): VaultEventsShell | null {
  if (typeof window === "undefined") return null;
  const vault = (window as { weft?: { vault?: Partial<VaultEventsShell> } }).weft?.vault;
  if (!vault || typeof vault.events !== "function") return null;
  return vault as VaultEventsShell;
}

// What the drawer asks for on open: the newest hundred rows of a vault.
export function eventsQuery(scope: VaultEventScope, since?: string | null): VaultEventsQuery {
  return { scope, ...(since ? { since } : {}) };
}

// The action as a phrase the drawer shows: "changed API_KEY", "added a blank for API_KEY".
// The vocabulary is the one the writers use (electron/vault-sync-server.cjs): "set", "add blank"
// and "remove". An action no writer has used yet is shown as it arrived, never guessed at.
const VERBS: Record<string, string> = {
  set: "changed",
  "add blank": "added a blank for",
  remove: "removed",
  "add": "added",
  added: "added",
  changed: "changed",
  removed: "removed",
};

// The design's vocabulary (docs/architecture/teams-vault.md, "vault_events"), for rows written by a
// card that hasn't landed yet: "secret.added" reads as "added", "device.added" as "added a device".
const DOTTED: Record<string, string> = {
  "secret.added": "added",
  "secret.changed": "changed",
  "secret.removed": "removed",
  "secret.blank_added": "added a blank for",
  "secret.filled": "filled in",
  "device.added": "added a device",
  "device.removed": "removed a device",
  "vault.rotated": "rotated the vault key",
  "vault.recovery_shown": "showed the recovery key",
};

// The verb for an action, whatever shape it arrived in. A known action gets its own verb; an
// unknown one reads as what it is, with the dots turned into words ("vault.something" -> "did
// something"), so a new writer's row is never mislabelled.
export function actionVerb(action: string): string {
  const known = VERBS[action] ?? DOTTED[action];
  if (known) return known;
  const tail = action.includes(".") ? action.slice(action.lastIndexOf(".") + 1) : action;
  return tail.replace(/_/g, " ");
}

// The whole line for a row: "Sam changed API_KEY", "Alex added a blank for API_KEY".
export function eventLine(event: VaultEvent): string {
  const verb = actionVerb(event.action);
  const name = event.targetName;
  const environment = event.targetEnvironment;
  if (!name) return verb;
  return environment ? `${verb} ${name} in ${environment}` : `${verb} ${name}`;
}

// Who did it, as a name: the email's first part, or the whole email when there is no better one.
// A system event (no actor) says so rather than blaming nobody.
export function actorName(event: VaultEvent): string {
  const email = event.actorEmail?.trim();
  if (!email) return event.actorUserId ? "A member" : "Weft";
  const local = email.split("@")[0] ?? email;
  return local || email;
}

// The row as the renderer gets it: only the named fields, from the server's row. Anything the
// server sends that isn't in this list is dropped, so a column added later can't leak into the UI.
export function toVaultEvent(row: Record<string, unknown>): VaultEvent {
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  return {
    id: text(row.id) ?? "",
    action: text(row.action) ?? "",
    targetName: text(row.target_name),
    targetEnvironment: text(row.target_environment),
    actorUserId: text(row.actor_user_id),
    actorEmail: text(row.actor_email),
    createdAt: text(row.created_at) ?? "",
  };
}

// The rows the renderer gets, in the order main sent them: newest first.
export function toVaultEvents(rows: Record<string, unknown>[]): VaultEvent[] {
  return rows.map(toVaultEvent);
}

// Whether a row belongs in the log under a scope. "mine" is the current user's own actions (the
// default); "all" is every member's, the team's view. Main filters the same way in the query, so
// this is the second gate: the live feed's rows come in one at a time and are checked here.
export function inScope(event: VaultEvent, scope: VaultEventScope, userId: string | null): boolean {
  if (scope === "all") return true;
  if (!userId) return false;
  return event.actorUserId === userId;
}

// The rows under a scope, newest first. A row's own id is its identity, so a row that arrives twice
// (a live append and the reload behind it) is only kept once.
export function filterEvents(events: VaultEvent[], scope: VaultEventScope, userId: string | null): VaultEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (!inScope(event, scope, userId)) return false;
    if (event.id && seen.has(event.id)) return false;
    if (event.id) seen.add(event.id);
    return true;
  });
}

// The rows that came after a timestamp: the live feed's append. A `since` of null means all of them.
export function newerThan(events: VaultEvent[], since: string | null): VaultEvent[] {
  if (!since) return events;
  return events.filter((event) => event.createdAt > since);
}

// The newest row's timestamp, or null for an empty log: the `since` the next read carries.
export function newestOf(events: VaultEvent[]): string | null {
  const first = events[0];
  if (!first) return null;
  return events.reduce((newest, event) => (event.createdAt > newest ? event.createdAt : newest), first.createdAt);
}

// The rows the tab shows after a live arrival: the new ones, in place, and the old ones after them,
// newest first, with the hundred most recent kept.
export function mergeEvents(existing: VaultEvent[], arrived: VaultEvent[], scope: VaultEventScope, userId: string | null): VaultEvent[] {
  const fresh = filterEvents(newerThan(arrived, newestOf(existing)), scope, userId);
  return [...fresh, ...filterEvents(existing, scope, userId)].slice(0, EVENTS_LIMIT);
}
