import { describe, expect, it } from "vitest";
import { BLANK, columnOf, rowPasses, sortRows, valueCountsOf } from "@aimhuge/sheet";
import { msOf, USERS_FRESH, USERS_SHEET, type AdminUserRow, type UserKey } from "./users-sheet";

const NOW = Date.parse("2026-10-26T12:00:00.000Z");

function user(overrides: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id: "u1",
    email: "ada@example.com",
    name: "Ada",
    avatarUrl: null,
    provider: "github",
    createdAt: "2026-10-26T09:00:00.000Z",
    lastSignInAt: null,
    lastSeenAt: "2026-10-26T11:00:00.000Z",
    ...overrides,
  };
}

// The column a key names, or undefined when the sheet has no such column.
function column(key: UserKey) {
  return columnOf(USERS_SHEET, key);
}

describe("msOf", () => {
  it("reads a time as milliseconds since the epoch", () => {
    expect(msOf("2026-10-26T09:00:00.000Z")).toBe(Date.parse("2026-10-26T09:00:00.000Z"));
  });

  it("has no time for a missing, empty or unreadable one", () => {
    expect(msOf(null)).toBeNull();
    expect(msOf("")).toBeNull();
    expect(msOf("not a date")).toBeNull();
  });
});

describe("the Users sheet's columns", () => {
  const userColumn = column("user");
  const providerColumn = column("provider");
  const joinedColumn = column("joined");
  const seenColumn = column("seen");

  it("names the columns it has", () => {
    expect(USERS_SHEET.columns.map((c) => c.key)).toEqual(["user", "provider", "joined", "seen", "id"]);
    expect(USERS_SHEET.columns.map((c) => c.label)).toEqual(["User", "Provider", "Joined", "Last seen", "ID"]);
    expect(columnOf(USERS_SHEET, undefined)).toBeUndefined();
  });

  it("shows a user's name, falling back to their email and then to blank", () => {
    expect(userColumn?.values(user({ name: "Ada" }), NOW)).toEqual(["Ada"]);
    expect(userColumn?.values(user({ name: null, email: "ada@example.com" }), NOW)).toEqual(["ada@example.com"]);
    expect(userColumn?.values(user({ name: null, email: null }), NOW)).toEqual([BLANK]);
  });

  it("shows a user's provider, or blank when they have none", () => {
    expect(providerColumn?.values(user({ provider: "github" }), NOW)).toEqual(["github"]);
    expect(providerColumn?.values(user({ provider: null }), NOW)).toEqual([BLANK]);
  });

  it("buckets when a user joined", () => {
    expect(joinedColumn?.values(user({ createdAt: "2026-10-26T09:00:00.000Z" }), NOW)).toEqual(["Today"]);
    expect(joinedColumn?.values(user({ createdAt: "2026-10-20T09:00:00.000Z" }), NOW)).toEqual(["This week"]);
    expect(joinedColumn?.values(user({ createdAt: "2026-10-01T09:00:00.000Z" }), NOW)).toEqual(["This month"]);
    expect(joinedColumn?.values(user({ createdAt: "2025-11-01T09:00:00.000Z" }), NOW)).toEqual(["This year"]);
    expect(joinedColumn?.values(user({ createdAt: "2025-01-01T09:00:00.000Z" }), NOW)).toEqual(["Older"]);
    expect(joinedColumn?.values(user({ createdAt: null }), NOW)).toEqual([BLANK]);
  });

  it("buckets when a user was last seen", () => {
    expect(seenColumn?.values(user({ lastSeenAt: "2026-10-26T11:00:00.000Z" }), NOW)).toEqual(["Today"]);
    expect(seenColumn?.values(user({ lastSeenAt: "2026-10-20T11:00:00.000Z" }), NOW)).toEqual(["This week"]);
    expect(seenColumn?.values(user({ lastSeenAt: "2026-10-01T11:00:00.000Z" }), NOW)).toEqual(["This month"]);
    expect(seenColumn?.values(user({ lastSeenAt: "2025-11-01T11:00:00.000Z" }), NOW)).toEqual(["This year"]);
    expect(seenColumn?.values(user({ lastSeenAt: "2025-01-01T11:00:00.000Z" }), NOW)).toEqual(["Older"]);
    expect(seenColumn?.values(user({ lastSeenAt: null }), NOW)).toEqual([BLANK]);
  });

  it("sorts the dates by how long ago they were", () => {
    expect(joinedColumn?.number?.(user({ createdAt: "2026-10-26T09:00:00.000Z" }), NOW)).toBe(NOW - Date.parse("2026-10-26T09:00:00.000Z"));
    expect(seenColumn?.number?.(user({ lastSeenAt: "2026-10-26T11:00:00.000Z" }), NOW)).toBe(NOW - Date.parse("2026-10-26T11:00:00.000Z"));
  });

  it("has no age for a user with no time", () => {
    expect(joinedColumn?.number?.(user({ createdAt: null }), NOW)).toBeNull();
    expect(seenColumn?.number?.(user({ lastSeenAt: null }), NOW)).toBeNull();
  });

  it("ranks the time buckets youngest first", () => {
    expect(joinedColumn?.rank?.("Today")).toBe(0);
    expect(joinedColumn?.rank?.("This week")).toBe(1);
    expect(joinedColumn?.rank?.("This month")).toBe(2);
    expect(joinedColumn?.rank?.("This year")).toBe(3);
    expect(joinedColumn?.rank?.("Older")).toBe(4);
    expect(seenColumn?.rank?.("Today")).toBe(0);
  });

  it("shows a user's id", () => {
    expect(column("id")?.values(user({ id: "abc-123" }), NOW)).toEqual(["abc-123"]);
  });
});

describe("the Users sheet's search", () => {
  it("finds a user by their name or their email", () => {
    expect(USERS_SHEET.search.text(user({ name: "Ada", email: "ada@example.com" }))).toBe("Ada ada@example.com");
    expect(rowPasses(user({ name: "Ada" }), USERS_SHEET, {}, "ada", NOW)).toBe(true);
    expect(rowPasses(user({ email: "ada@example.com" }), USERS_SHEET, {}, "example", NOW)).toBe(true);
    expect(rowPasses(user({ name: "Grace", email: "grace@example.com" }), USERS_SHEET, {}, "ada", NOW)).toBe(false);
  });

  it("searches a user with no name or no email", () => {
    expect(USERS_SHEET.search.text(user({ name: null, email: null }))).toBe(" ");
    expect(rowPasses(user({ name: null, email: null }), USERS_SHEET, {}, "ada", NOW)).toBe(false);
    expect(rowPasses(user({ name: null, email: "ada@example.com" }), USERS_SHEET, {}, "ada", NOW)).toBe(true);
    expect(rowPasses(user({ name: "Ada", email: null }), USERS_SHEET, {}, "ada", NOW)).toBe(true);
  });
});

describe("the Users sheet's sorting", () => {
  const rows = [
    user({ id: "old", name: "Old", createdAt: "2025-01-01T00:00:00.000Z", lastSeenAt: null }),
    user({ id: "new", name: "New", createdAt: "2026-10-26T09:00:00.000Z", lastSeenAt: "2026-10-26T11:00:00.000Z" }),
    user({ id: "mid", name: "Mid", createdAt: "2026-10-20T00:00:00.000Z", lastSeenAt: "2026-10-20T00:00:00.000Z" }),
  ];

  it("sorts the newest accounts first when joining ascends", () => {
    const sorted = sortRows(rows, USERS_SHEET, { key: "joined", dir: "asc" }, NOW);
    expect(sorted.map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });

  it("sorts by last seen, with the users never seen last", () => {
    const sorted = sortRows(rows, USERS_SHEET, { key: "seen", dir: "asc" }, NOW);
    expect(sorted.map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });

  it("counts the values in a column", () => {
    const provider = column("provider");
    expect(provider).toBeDefined();
    const counts = valueCountsOf([user({ provider: "github" }), user({ provider: null }), user({ provider: "github" })], provider!, NOW);
    expect(counts).toEqual([{ value: "github", count: 2 }, { value: BLANK, count: 1 }]);
  });
});

describe("USERS_FRESH", () => {
  it("starts with the newest accounts first and nothing filtered", () => {
    expect(USERS_FRESH).toEqual({ sort: { key: "joined", dir: "asc" }, hidden: {}, query: "", collapsed: [] });
  });
});
