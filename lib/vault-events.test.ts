import { describe, expect, it } from "vitest";
import {
  EVENTS_LIMIT,
  actionVerb,
  actorName,
  eventLine,
  eventsQuery,
  filterEvents,
  inScope,
  mergeEvents,
  newestOf,
  newerThan,
  toVaultEvent,
  toVaultEvents,
  vaultEventsBridge,
  type VaultEvent,
} from "./vault-events";

// The event log's contract (docs/architecture/teams-vault.md, "What the 🔐 drawer shows"):
// who did what, never a value; the newest rows first; the default filter is the current user's own
// actions, and "all" is the team's view.

const row = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  vault_id: "v1",
  actor_user_id: "u1",
  actor_email: "sam@example.com",
  device_id: "d1",
  action: "set",
  target_name: "API_KEY",
  target_environment: "development",
  metadata: { row_version: 3 },
  created_at: "2026-10-27T10:00:00.000Z",
  ...over,
});

describe("the event log's contract", () => {
  it("keeps the last hundred rows, and asks for a scope and a since", () => {
    expect(EVENTS_LIMIT).toBe(100);
    expect(eventsQuery("mine")).toEqual({ scope: "mine" });
    expect(eventsQuery("all", "2026-10-27T10:00:00.000Z")).toEqual({ scope: "all", since: "2026-10-27T10:00:00.000Z" });
    // A page's first ask carries no since at all.
    expect(eventsQuery("mine", null)).toEqual({ scope: "mine" });
  });

  it("takes only the named fields from a server row, and drops everything else", () => {
    const event = toVaultEvent(row());
    expect(event).toEqual({
      id: "e1",
      action: "set",
      targetName: "API_KEY",
      targetEnvironment: "development",
      actorUserId: "u1",
      actorEmail: "sam@example.com",
      createdAt: "2026-10-27T10:00:00.000Z",
    });
    // The vault's id, the device and the writer's metadata are the server's business, not the tab's.
    expect(Object.keys(event)).not.toContain("metadata");
    expect(JSON.stringify(event)).not.toContain("row_version");
  });

  it("never carries a value out of a row, whatever the server sent", () => {
    const event = toVaultEvent(row({ metadata: { value: "sk-live-1234", ciphertext: "Zm9vYmFy" }, hint: "sk-live-1234" }));
    expect(JSON.stringify(event)).not.toMatch(/sk-live-1234/);
    expect(JSON.stringify(event)).not.toMatch(/Zm9vYmFy/);
    // The row has a fixed shape: the server's extra columns are not in it.
    expect(Object.keys(event).sort()).toEqual(["action", "actorEmail", "actorUserId", "createdAt", "id", "targetEnvironment", "targetName"]);
  });

  it("reads a row without an actor, a name or an environment", () => {
    const event = toVaultEvent(row({ actor_user_id: null, actor_email: null, target_name: null, target_environment: null, action: "vault.rotated" }));
    expect(event.actorUserId).toBeNull();
    expect(event.actorEmail).toBeNull();
    expect(event.targetName).toBeNull();
    expect(event.targetEnvironment).toBeNull();
  });

  it("reads a row whose fields are the wrong type as nothing", () => {
    const event = toVaultEvent({ id: 7, action: "", target_name: 42, actor_email: null, created_at: null });
    expect(event.id).toBe("");
    expect(event.action).toBe("");
    expect(event.targetName).toBeNull();
    expect(event.createdAt).toBe("");
  });

  it("keeps the rows in the order main sent them, newest first", () => {
    const events = toVaultEvents([row({ id: "e3" }), row({ id: "e2" }), row({ id: "e1" })]);
    expect(events.map((e) => e.id)).toEqual(["e3", "e2", "e1"]);
  });
});

describe("the event log's wording", () => {
  const event = (over: Partial<VaultEvent> = {}): VaultEvent => ({
    id: "e1",
    action: "set",
    targetName: "API_KEY",
    targetEnvironment: "development",
    actorUserId: "u1",
    actorEmail: "sam@example.com",
    createdAt: "2026-10-27T10:00:00.000Z",
    ...over,
  });

  it("says what the writers' own actions are", () => {
    // The vocabulary in use is electron/vault-sync-server.cjs's: "set", "add blank", "remove".
    expect(actionVerb("set")).toBe("changed");
    expect(actionVerb("add blank")).toBe("added a blank for");
    expect(actionVerb("remove")).toBe("removed");
    expect(eventLine(event())).toBe("changed API_KEY in development");
    expect(eventLine(event({ action: "add blank" }))).toBe("added a blank for API_KEY in development");
    expect(eventLine(event({ action: "remove" }))).toBe("removed API_KEY in development");
  });

  it("says what the design's vocabulary is, for a writer that hasn't landed yet", () => {
    expect(actionVerb("secret.added")).toBe("added");
    expect(actionVerb("secret.blank_added")).toBe("added a blank for");
    expect(actionVerb("device.added")).toBe("added a device");
    expect(actionVerb("vault.rotated")).toBe("rotated the vault key");
    expect(eventLine(event({ action: "device.added", targetName: null, targetEnvironment: null }))).toBe("added a device");
  });

  it("says an action it doesn't know as it is, rather than guessing", () => {
    expect(actionVerb("vault.something_new")).toBe("something new");
    expect(actionVerb("mystery")).toBe("mystery");
    expect(eventLine(event({ action: "mystery" }))).toBe("mystery API_KEY in development");
  });

  it("leaves the environment out when the action named none", () => {
    expect(eventLine(event({ targetEnvironment: null }))).toBe("changed API_KEY");
    expect(eventLine(event({ targetName: null }))).toBe("changed");
  });

  it("names the actor, and says Weft when nobody did it", () => {
    expect(actorName(event())).toBe("sam");
    expect(actorName(event({ actorEmail: "sam@example.com" }))).toBe("sam");
    expect(actorName(event({ actorEmail: null, actorUserId: "u2" }))).toBe("A member");
    expect(actorName(event({ actorEmail: null, actorUserId: null }))).toBe("Weft");
    expect(actorName(event({ actorEmail: "   " }))).toBe("A member");
    expect(actorName(event({ actorEmail: "   ", actorUserId: null }))).toBe("Weft");
  });
});

describe("the event log's filter", () => {
  const event = (over: Partial<VaultEvent> = {}): VaultEvent => ({
    id: "e1",
    action: "set",
    targetName: "API_KEY",
    targetEnvironment: "development",
    actorUserId: "u1",
    actorEmail: "sam@example.com",
    createdAt: "2026-10-27T10:00:00.000Z",
    ...over,
  });

  it("shows the current user's own actions by default", () => {
    const mine = event({ id: "mine", actorUserId: "u1" });
    const theirs = event({ id: "theirs", actorUserId: "u2", actorEmail: "alex@example.com" });
    expect(inScope(mine, "mine", "u1")).toBe(true);
    expect(inScope(theirs, "mine", "u1")).toBe(false);
    expect(filterEvents([mine, theirs], "mine", "u1").map((e) => e.id)).toEqual(["mine"]);
  });

  it("shows every member's actions in the team's view", () => {
    const mine = event({ id: "mine", actorUserId: "u1" });
    const theirs = event({ id: "theirs", actorUserId: "u2", actorEmail: "alex@example.com" });
    expect(inScope(theirs, "all", "u1")).toBe(true);
    expect(filterEvents([mine, theirs], "all", "u1").map((e) => e.id)).toEqual(["mine", "theirs"]);
  });

  it(`shows nothing under "mine" when nobody is signed in`, () => {
    expect(inScope(event(), "mine", null)).toBe(false);
    expect(filterEvents([event()], "mine", null)).toEqual([]);
    // The team's view still works without a user id: nobody to filter by is not a filter.
    expect(filterEvents([event()], "all", null).length).toBe(1);
  });

  it("keeps a row only once, so a live row and the reload behind it don't double", () => {
    const one = event({ id: "e1" });
    expect(filterEvents([one, one], "all", null).length).toBe(1);
  });

  it("takes only the rows that came after a since", () => {
    const older = event({ id: "old", createdAt: "2026-10-27T09:00:00.000Z" });
    const newer = event({ id: "new", createdAt: "2026-10-27T11:00:00.000Z" });
    const same = event({ id: "same", createdAt: "2026-10-27T10:00:00.000Z" });
    expect(newerThan([older, newer, same], "2026-10-27T10:00:00.000Z").map((e) => e.id)).toEqual(["new"]);
    // A since of null takes everything.
    expect(newerThan([older, newer], null).length).toBe(2);
  });

  it("knows the newest row's timestamp, and none for an empty log", () => {
    expect(newestOf([event({ createdAt: "2026-10-27T09:00:00.000Z" }), event({ createdAt: "2026-10-27T11:00:00.000Z" })])).toBe("2026-10-27T11:00:00.000Z");
    expect(newestOf([])).toBeNull();
  });

  it("puts a live row in front of the older ones, newest first", () => {
    const old = event({ id: "old", createdAt: "2026-10-27T09:00:00.000Z" });
    const arrived = event({ id: "new", createdAt: "2026-10-27T11:00:00.000Z" });
    expect(mergeEvents([old], [arrived], "all", null).map((e) => e.id)).toEqual(["new", "old"]);
  });

  it("keeps a hundred rows at most", () => {
    // The log arrives newest first, like the server sends it.
    const many = Array.from({ length: 120 }, (_, n) => event({ id: `e${n}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString() })).reverse();
    // The hundred older rows are in the list; the twenty newer ones arrive live.
    const existing = many.slice(20);
    const merged = mergeEvents(existing, many.slice(0, 20), "all", null);
    expect(merged.length).toBe(EVENTS_LIMIT);
    // The newest hundred, newest first: e119 is the newest row, e0 the oldest.
    expect(merged[0]?.id).toBe("e119");
    expect(merged.at(-1)?.id).toBe("e20");
  });

  it(`doesn't take a live row twice, and leaves a teammate's row out of "mine"`, () => {
    const old = event({ id: "old", createdAt: "2026-10-27T09:00:00.000Z", actorUserId: "u1" });
    const arrived = event({ id: "new", createdAt: "2026-10-27T11:00:00.000Z", actorUserId: "u2", actorEmail: "alex@example.com" });
    // A teammate's row stays out of "mine", and the older one is still there.
    expect(mergeEvents([old], [arrived], "mine", "u1").map((e) => e.id)).toEqual(["old"]);
    // In the team's view the new row leads, and the old one isn't repeated: the live batch and the
    // list behind it are the same row.
    expect(mergeEvents([old], [old, arrived], "all", null).map((e) => e.id)).toEqual(["new", "old"]);
  });
});

// The tab's part of the shell: read off the window, and absent in a shell without it.
describe("the tab's bridge", () => {
  it("is the shell's vault bridge when it has the log, and nothing otherwise", () => {
    const withEvents = { events: () => Promise.resolve({ events: [], since: null }) };
    (globalThis as { window?: unknown }).window = { weft: { vault: withEvents } };
    expect(vaultEventsBridge()).toBe(withEvents);

    // A shell from before the tab has a vault bridge without the log.
    (globalThis as { window?: unknown }).window = { weft: { vault: { overview: () => Promise.resolve({}) } } };
    expect(vaultEventsBridge()).toBeNull();

    (globalThis as { window?: unknown }).window = {};
    expect(vaultEventsBridge()).toBeNull();

    delete (globalThis as { window?: unknown }).window;
  });
});
