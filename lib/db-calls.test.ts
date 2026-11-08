import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pending, Session } from "./runner-state";
import type { PendingSql, SqlReview, ThreadItem } from "./types";

const h = vi.hoisted(() => ({
  settings: { sqlAutoAccept: undefined as boolean | undefined },
  save: vi.fn(),
  thread: [] as unknown[],
  replaceThreadItem: vi.fn(),
  safeUpdate: vi.fn(),
  settle: vi.fn(),
  reviewSql: vi.fn(),
  card: undefined as { safeSql?: boolean } | undefined,
}));

vi.mock("./settings-store", () => ({ settings: () => h.settings, save: h.save }));
vi.mock("./store", () => ({ getCard: () => h.card, getThread: () => h.thread, replaceThreadItem: h.replaceThreadItem }));
vi.mock("./runner-state", () => ({ safeUpdate: h.safeUpdate }));
vi.mock("./runner-pending", () => ({ settle: h.settle, pendingView: (p: Pending) => ({ id: p.id, sql: p.sql }) }));
vi.mock("./sql-review", () => ({ reviewSql: h.reviewSql }));

const db = await import("./db-calls");

const session = (pending: Pending[] = []) => ({ pending, spec: { cwd: "/tmp" } }) as unknown as Session;
const prompt = (over: Partial<Pending> = {}): Pending => ({ id: "p1", index: 2, toolName: "mcp__supabase__execute_sql", title: "t", input: {}, resolve: vi.fn(), ...over });
const review = (over: Partial<SqlReview> = {}): SqlReview => ({ verdict: "safe", summary: "s", statements: [], concerns: [], model: "sonnet", ...over });
const sqlOf = (sql: string): PendingSql => ({ server: "supabase", tool: "execute_sql", sql, flagged: [] });
// SQL the static scan flagged, so it goes to the model review.
const flaggedOf = (sql: string): PendingSql => ({ ...sqlOf(sql), flagged: [0] });

beforeEach(() => {
  vi.clearAllMocks();
  h.settings = { sqlAutoAccept: undefined };
  h.thread = [];
  h.card = undefined;
});

describe("dbCall", () => {
  it("reads the Supabase MCP's execute_sql query", () => {
    expect(db.dbCall("mcp__supabase__execute_sql", { query: "select 1" })).toEqual({ server: "supabase", tool: "execute_sql", sql: "select 1" });
  });

  it("reads apply_migration with its name, on the claude.ai connector too", () => {
    expect(db.dbCall("mcp__claude_ai_Supabase__apply_migration", { query: "drop table t", name: "m1" })).toEqual({
      server: "claude_ai_Supabase",
      tool: "apply_migration",
      sql: "drop table t",
      name: "m1",
    });
  });

  it("leaves out a name that isn't a non-empty string", () => {
    expect(db.dbCall("mcp__supabase__apply_migration", { query: "x", name: "" })).not.toHaveProperty("name");
    expect(db.dbCall("mcp__supabase__apply_migration", { query: "x", name: 3 })).not.toHaveProperty("name");
  });

  it("reads a postgres MCP's sql key, else its query", () => {
    expect(db.dbCall("mcp__postgres__execute_sql", { sql: "select 2" })).toEqual({ server: "postgres", tool: "execute_sql", sql: "select 2" });
    expect(db.dbCall("mcp__my_pg__query", { query: "select 3" })).toMatchObject({ server: "my_pg", sql: "select 3" });
  });

  it("is undefined for a tool that isn't a database call, or carries no SQL", () => {
    expect(db.dbCall("Bash", { query: "select 1" })).toBeUndefined();
    expect(db.dbCall("mcp__supabase__list_tables", { query: "x" })).toBeUndefined();
    expect(db.dbCall("mcp__supabase__execute_sql", { query: "   " })).toBeUndefined();
    expect(db.dbCall("mcp__supabase__execute_sql", { query: 1 })).toBeUndefined();
  });
});

describe("tracking calls in flight", () => {
  it("records a database call and ends it on its result", () => {
    const s = session();
    db.trackDbCall(s, "t1", "mcp__supabase__execute_sql", { query: "select 1" });
    expect([...(s.dbCalls?.keys() ?? [])]).toEqual(["t1"]);
    db.endDbCall(s, "t1");
    expect(s.dbCalls?.size).toBe(0);
  });

  it("ignores tools that aren't database calls", () => {
    const s = session();
    db.trackDbCall(s, "t1", "Read", { file_path: "a" });
    expect(s.dbCalls).toBeUndefined();
    db.endDbCall(s, "t1");
  });

  it("matches an elicitation's server by its normalized name, else takes the newest call", () => {
    const s = session();
    db.trackDbCall(s, "a", "mcp__claude_ai_Supabase__execute_sql", { query: "select 'a'" });
    db.trackDbCall(s, "b", "mcp__postgres__execute_sql", { sql: "select 'b'" });
    expect(db.inFlightCall(s, "claude.ai Supabase")?.sql).toBe("select 'a'");
    expect(db.inFlightCall(s, "other")?.sql).toBe("select 'b'");
    expect(db.inFlightCall(session(), "x")).toBeUndefined();
  });
});

describe("promptSql", () => {
  it("gives a Bash command's psql SQL, flagged or not, and nothing for a command with no SQL", () => {
    expect(db.promptSql(session(), "Bash", { command: 'psql "$URL" -c "delete from t"' })).toMatchObject({ server: "bash", tool: "psql", sql: "delete from t" });
    expect(db.promptSql(session(), "Bash", { command: 'psql -c "select 1"' })).toMatchObject({ server: "bash", sql: "select 1", flagged: [] });
    expect(db.promptSql(session(), "Bash", { command: "ls" })).toBeUndefined();
  });

  it("never tracks a Bash command as a running database call", () => {
    const s = session();
    db.trackDbCall(s, "b", "Bash", { command: 'psql -c "delete from t"' });
    expect(s.dbCalls).toBeUndefined();
  });

  it("reads no Bash SQL without a command or a folder", () => {
    expect(db.dbCall("Bash", { command: 1 }, "/tmp")).toBeUndefined();
    expect(db.dbCall("Bash", { command: 'psql -c "delete from t"' })).toBeUndefined();
  });

  it("gives an elicitation its server's in-flight call, flagged", () => {
    const s = session();
    db.trackDbCall(s, "a", "mcp__supabase__execute_sql", { query: "drop table t" });
    const sql = db.promptSql(s, "mcp__supabase__elicitation", {}, "supabase");
    expect(sql).toMatchObject({ server: "supabase", sql: "drop table t" });
    expect(sql?.flagged.length).toBeGreaterThan(0);
  });

  it("is undefined for an elicitation with nothing in flight", () => {
    expect(db.promptSql(session(), "mcp__supabase__elicitation", {}, "supabase")).toBeUndefined();
  });

  it("gives a plain SELECT's SQL with nothing flagged, and nothing for a non-database tool", () => {
    expect(db.promptSql(session(), "mcp__supabase__execute_sql", { query: "select 1" })).toEqual({ server: "supabase", tool: "execute_sql", sql: "select 1", flagged: [] });
    expect(db.promptSql(session(), "Read", { file_path: "a" })).toBeUndefined();
  });

  it("attaches destructive SQL a permission prompt asks about", () => {
    expect(db.promptSql(session(), "mcp__supabase__execute_sql", { query: "delete from t" })).toMatchObject({ sql: "delete from t" });
  });
});

describe("pendingSql", () => {
  it("names what lossy SQL loses", () => {
    expect(db.pendingSql({ server: "supabase", tool: "execute_sql", sql: "delete from t;\ntruncate u" })).toMatchObject({
      flagged: [0, 1],
      loses: "deletes every row in t and deletes every row in u",
    });
  });

  it("leaves loses out when nothing is lost", () => {
    expect(db.pendingSql({ server: "supabase", tool: "execute_sql", sql: "grant select on t to anon" })).not.toHaveProperty("loses");
    expect(db.pendingSql({ server: "supabase", tool: "execute_sql", sql: "select 1" })).toEqual({ server: "supabase", tool: "execute_sql", sql: "select 1", flagged: [] });
  });
});

describe("the Accept harmless SQL switch", () => {
  it("reads off by default and saves a change", () => {
    expect(db.sqlAutoAccept()).toBe(false);
    db.setSqlAutoAccept(true);
    expect(h.settings.sqlAutoAccept).toBe(true);
    expect(h.save).toHaveBeenCalled();
    expect(db.sqlAutoAccept()).toBe(true);
  });
});

describe("harmless", () => {
  const sql = sqlOf("select 1");
  it("needs a Safe verdict with no error, a clean static scan and no form", () => {
    expect(db.harmless(sql, review(), {})).toBe(true);
    expect(db.harmless(sql, review({ verdict: "deletes" }), {})).toBe(false);
    expect(db.harmless(sql, review({ error: "boom" }), {})).toBe(false);
    expect(db.harmless(sqlOf("delete from t"), review(), {})).toBe(false);
    const fields = [{ name: "n", title: "N", required: true, kind: "integer" as const }];
    expect(db.harmless(sql, review(), { elicitation: { server: "s", message: "m", fields } })).toBe(false);
    expect(db.harmless(sql, review(), { elicitation: { server: "s", message: "m", fields: [] } })).toBe(true);
  });
});

describe("reviewPrompt", () => {
  it("does nothing for a prompt with no SQL", async () => {
    const fn = vi.fn();
    await db.reviewPrompt("c1", session(), prompt(), fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it("drops the review when the prompt was answered meanwhile", async () => {
    const p = prompt({ sql: sqlOf("drop table t") });
    await db.reviewPrompt("c1", session([]), p, () => Promise.resolve(review()));
    expect(p.sql?.review).toBeUndefined();
    expect(h.safeUpdate).not.toHaveBeenCalled();
  });

  it("puts the review on the card when the prompt is first and showing", async () => {
    const p = prompt({ sql: { ...flaggedOf("drop table t"), name: "m1" } });
    const fn = vi.fn(() => Promise.resolve(review({ verdict: "deletes" })));
    await db.reviewPrompt("c1", session([p]), p, fn);
    expect(fn).toHaveBeenCalledWith("drop table t", "m1");
    expect(h.safeUpdate).toHaveBeenCalledWith("c1", { pending: { id: "p1", sql: p.sql } });
    expect(p.sql?.review?.verdict).toBe("deletes");
  });

  it("only stores the review when the prompt isn't first, or is waiting", async () => {
    const first = prompt({ id: "p0" });
    const p = prompt({ sql: flaggedOf("drop table t") });
    await db.reviewPrompt("c1", session([first, p]), p, () => Promise.resolve(review()));
    expect(p.sql?.review?.verdict).toBe("safe");
    const w = prompt({ sql: flaggedOf("drop table t"), waiting: true });
    await db.reviewPrompt("c1", session([w]), w, () => Promise.resolve(review()));
    expect(h.safeUpdate).not.toHaveBeenCalled();
  });

  it("gives unflagged SQL the static Safe review without calling the review", async () => {
    const p = prompt({ sql: sqlOf("select 1") });
    const fn = vi.fn();
    await db.reviewPrompt("c1", session([p]), p, fn);
    expect(fn).not.toHaveBeenCalled();
    expect(h.reviewSql).not.toHaveBeenCalled();
    expect(p.sql?.review).toEqual({ verdict: "safe", summary: "Nothing in it deletes, drops or changes access.", statements: [], concerns: [], model: db.STATIC_MODEL });
    expect(h.safeUpdate).toHaveBeenCalledWith("c1", { pending: { id: "p1", sql: p.sql } });
    expect(h.settle).not.toHaveBeenCalled();
  });

  it("accepts a harmless one when this card allows safe SQL, with the global switch off", async () => {
    h.card = { safeSql: true };
    h.thread = [{}, {}, { kind: "permission", title: "t" }];
    const p = prompt({ sql: flaggedOf("grant select on t to anon") });
    await db.reviewPrompt("c1", session([p]), p, () => Promise.resolve(review()));
    expect(p.sql?.autoAccepted).toBe(true);
    expect(h.settle).toHaveBeenCalledWith("c1", true, undefined, "p1");
    expect(h.safeUpdate).not.toHaveBeenCalled();
  });

  it("still asks on a card without safe SQL when the global switch is off", async () => {
    h.card = { safeSql: false };
    const p = prompt({ sql: sqlOf("select 1") });
    await db.reviewPrompt("c1", session([p]), p);
    expect(h.settle).not.toHaveBeenCalled();
    expect(h.safeUpdate).toHaveBeenCalled();
  });

  it("uses reviewSql by default", async () => {
    h.reviewSql.mockResolvedValue(review());
    const p = prompt({ sql: flaggedOf("drop table t") });
    await db.reviewPrompt("c1", session([p]), p);
    expect(h.reviewSql).toHaveBeenCalledWith("drop table t", undefined);
  });

  describe("with Accept harmless SQL on", () => {
    beforeEach(() => {
      h.settings.sqlAutoAccept = true;
    });

    it("accepts a harmless one and says why in the thread", async () => {
      h.thread = [{}, {}, { kind: "permission", title: "t" }];
      const p = prompt({ sql: flaggedOf("grant select on t to anon") });
      await db.reviewPrompt("c1", session([p]), p, () => Promise.resolve(review({ model: "haiku" })));
      expect(p.sql?.autoAccepted).toBe(true);
      expect(h.settle).toHaveBeenCalledWith("c1", true, undefined, "p1");
      expect(h.replaceThreadItem).toHaveBeenCalledWith("c1", 2, { kind: "permission", title: "t", auto: "the haiku review said Safe" } as unknown as ThreadItem);
      expect(h.safeUpdate).not.toHaveBeenCalled();
    });

    it("says nothing in the SQL deletes when the static scan alone passed it", async () => {
      h.thread = [{}, {}, { kind: "permission", title: "t" }];
      const p = prompt({ sql: sqlOf("select 1") });
      await db.reviewPrompt("c1", session([p]), p);
      expect(h.replaceThreadItem).toHaveBeenCalledWith("c1", 2, { kind: "permission", title: "t", auto: "nothing in the SQL deletes or changes access" } as unknown as ThreadItem);
    });

    it("leaves the thread alone when its item isn't the permission", async () => {
      h.thread = [];
      const p = prompt({ sql: sqlOf("select 1") });
      await db.reviewPrompt("c1", session([p]), p, () => Promise.resolve(review()));
      expect(h.settle).toHaveBeenCalled();
      expect(h.replaceThreadItem).not.toHaveBeenCalled();
    });

    it("still asks when the verdict deletes, the scan finds loss, a form waits or the review failed", async () => {
      const fields = [{ name: "n", title: "N", required: true, kind: "integer" as const }];
      const cases: [PendingSql, SqlReview, Partial<Pending>][] = [
        [flaggedOf("grant select on t to anon"), review({ verdict: "deletes" }), {}],
        [flaggedOf("delete from t"), review(), {}],
        [sqlOf("select 1"), review(), { elicitation: { server: "s", message: "m", fields } }],
        [flaggedOf("grant select on t to anon"), review({ verdict: "unknown", error: "timeout" }), {}],
      ];
      for (const [sql, r, over] of cases) {
        const p = prompt({ sql, ...over });
        await db.reviewPrompt("c1", session([p]), p, () => Promise.resolve(r));
      }
      expect(h.settle).not.toHaveBeenCalled();
      expect(h.safeUpdate).toHaveBeenCalledTimes(4);
    });
  });
});

describe("attachSql", () => {
  it("puts flagged SQL on the prompt and starts its review", async () => {
    h.reviewSql.mockResolvedValue(review({ verdict: "deletes" }));
    const p = prompt({ input: { query: "drop table t" } });
    const s = session([p]);
    db.attachSql("c1", s, p);
    expect(p.sql).toMatchObject({ sql: "drop table t" });
    await vi.waitFor(() => expect(p.sql?.review?.verdict).toBe("deletes"));
  });

  it("uses the elicitation's server's in-flight call", () => {
    h.reviewSql.mockResolvedValue(review());
    const s = session();
    db.trackDbCall(s, "a", "mcp__supabase__execute_sql", { query: "select 1" });
    const p = prompt({ toolName: "mcp__supabase__elicitation", elicitation: { server: "supabase", message: "m", fields: [] } });
    db.attachSql("c1", s, p);
    expect(p.sql).toMatchObject({ sql: "select 1" });
  });

  it("leaves a prompt without SQL alone", () => {
    const p = prompt({ toolName: "Bash", input: { command: "ls" } });
    db.attachSql("c1", session([p]), p);
    expect(p.sql).toBeUndefined();
    expect(h.reviewSql).not.toHaveBeenCalled();
  });
});
