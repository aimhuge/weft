// A worker's connector grants, made in main (electron/connector-grants.cjs): Touch ID before turning one on or giving
// cards more, none for a stricter change, and its copy of the rules held to lib/connector-grant.ts.
import { describe, expect, it, vi } from "vitest";
import * as shared from "../lib/connector-grant";
import grants from "./connector-grants.cjs";

const { registerConnectorGrants } = grants;
type Fn = (...args: unknown[]) => Promise<unknown>;

// A chain like supabase-js's: every filter returns the chain, and awaiting it (or maybeSingle) gives `result`.
function fakeDb(read: { data?: unknown; error?: unknown } = {}, write: { error?: unknown } = {}) {
  const calls: { table: string; op: string; arg?: unknown; eq: [string, unknown][] }[] = [];
  const db = vi.fn(() => ({
    from: (table: string) => {
      const call = (op: string, arg?: unknown) => {
        const c = { table, op, arg, eq: [] as [string, unknown][] };
        calls.push(c);
        const chain = {
          eq: (k: string, v: unknown) => (c.eq.push([k, v]), chain),
          maybeSingle: () => Promise.resolve({ data: read.data ?? null, error: read.error ?? null }),
          then: (ok: (v: unknown) => unknown, no?: (e: unknown) => unknown) => Promise.resolve({ error: write.error ?? null }).then(ok, no),
        };
        return chain;
      };
      return { select: (cols: string) => call("select", cols), update: (v: unknown) => call("update", v), insert: (v: unknown) => call("insert", v) };
    },
  }));
  return { db, calls };
}

function setup(opts: { uid?: string | null; yes?: boolean; read?: { data?: unknown; error?: unknown }; write?: { error?: unknown } } = {}) {
  const handlers = new Map<string, Fn>();
  const { db, calls } = fakeDb(opts.read, opts.write);
  const confirm = vi.fn<(reason: string) => Promise<boolean>>(() => Promise.resolve(opts.yes ?? true));
  registerConnectorGrants((ch: string, fn: (...args: never[]) => unknown) => void handlers.set(ch, fn as Fn), { db, userId: () => (opts.uid === undefined ? "u1" : opts.uid), confirm });
  return { set: handlers.get("connectors:set")!, allow: handlers.get("connectors:allow")!, handlers, calls, confirm };
}

const STRICT = { scope: "card", approval: "card", lifetime: "8h", asks: ["protected_push"] };

describe("connectors:set", () => {
  it("registers both channels", () => {
    expect([...setup().handlers.keys()]).toEqual(["connectors:set", "connectors:allow"]);
  });

  it("refuses when signed out, and for a connector it doesn't know", async () => {
    await expect(setup({ uid: null }).set("w1", "box", "github", {})).rejects.toThrow("Sign in to Weft first.");
    await expect(setup().set("w1", "box", "gitlab", {})).rejects.toThrow("doesn't know that connector");
  });

  it("asks Touch ID, naming the worker, before turning it on, and writes only on yes", async () => {
    const s = setup();
    expect(await s.set("w1", "m1\nmini", "github", { scope: "project", bogus: 1 })).toEqual({ ok: true, settings: { scope: "project", approval: "worker", lifetime: "revoked", asks: ["protected_push"] } });
    expect(s.confirm).toHaveBeenCalledWith("let the worker m1?mini use GitHub as you, with Weft, for cards you start on it");
    expect(s.calls[0]).toMatchObject({ table: "connector_grants", op: "select", eq: [["user_id", "u1"], ["worker_id", "w1"], ["connector", "github"]] });
    expect(s.calls[1]).toMatchObject({ op: "insert", arg: { worker_id: "w1", connector: "github", scope: "project", approval: "worker", lifetime: "revoked", asks: ["protected_push"] } });
    const no = setup({ yes: false });
    expect(await no.set("w1", "", "github", {})).toEqual({ denied: true });
    expect(no.confirm.mock.calls[0]![0]).toContain("the worker w1 use");
    expect(no.calls.map((c) => c.op)).toEqual(["select"]);
  });

  it("makes a stricter change without asking", async () => {
    const s = setup({ read: { data: { scope: "installed", approval: "worker", lifetime: "revoked", asks: [] } } });
    expect(await s.set("w1", "box", "github", STRICT)).toMatchObject({ ok: true });
    expect(s.confirm).not.toHaveBeenCalled();
    expect(s.calls[1]).toMatchObject({ op: "update", arg: STRICT, eq: [["user_id", "u1"], ["worker_id", "w1"], ["connector", "github"]] });
  });

  it("asks before a looser change", async () => {
    const s = setup({ read: { data: STRICT } });
    await s.set("w1", "box", "github", { ...STRICT, scope: "installed" });
    expect(s.confirm).toHaveBeenCalledWith("give cards on the worker box more GitHub access (installed repos, approval card, lifetime 8h)");
    const no = setup({ read: { data: STRICT }, yes: false });
    expect(await no.set("w1", "box", "github", { ...STRICT, asks: [] })).toEqual({ denied: true });
    expect(no.calls.map((c) => c.op)).toEqual(["select"]);
  });

  it("throws on a read or write error", async () => {
    await expect(setup({ read: { error: { message: "rls" } } }).set("w1", "b", "github", {})).rejects.toThrow("Couldn't read the grant: rls");
    await expect(setup({ write: { error: { message: "denied" } } }).set("w1", "b", "github", {})).rejects.toThrow("Couldn't save the grant: denied");
  });
});

describe("connectors:allow", () => {
  it("allows a project or a card after Touch ID", async () => {
    const s = setup();
    expect(await s.allow("g1", "box", "project", "o/r")).toEqual({ ok: true });
    expect(s.confirm).toHaveBeenCalledWith("let the project o/r on the worker box use GitHub as you");
    expect(s.calls[0]).toMatchObject({ table: "connector_allows", op: "insert", arg: { grant_id: "g1", kind: "project", subject: "o/r" } });
    await s.allow("g1", "box", "card", "c".repeat(300), "Fix it");
    expect(s.confirm).toHaveBeenLastCalledWith('let the card "Fix it" on the worker box use GitHub as you');
    expect((s.calls[1]!.arg as { subject: string }).subject).toHaveLength(201);
    await s.allow("g1", "box", "card", "card-id");
    expect(s.confirm).toHaveBeenLastCalledWith('let the card "card-id" on the worker box use GitHub as you');
    await s.allow("g1", undefined, "project", "o/r");
    expect(s.confirm).toHaveBeenLastCalledWith("let the project o/r on the worker  use GitHub as you");
  });

  it("refuses a bad kind or no sign-in, and writes nothing on no", async () => {
    await expect(setup().allow("g1", "box", "repo", "x")).rejects.toThrow("Allow a project or a card.");
    await expect(setup({ uid: null }).allow("g1", "box", "card", "x")).rejects.toThrow("Sign in to Weft first.");
    const no = setup({ yes: false });
    expect(await no.allow("g1", "box", "card", "x")).toEqual({ denied: true });
    expect(no.calls).toEqual([]);
  });

  it("takes an Allow that's already there, and throws on other errors", async () => {
    expect(await setup({ write: { error: { code: "23505", message: "dup" } } }).allow("g1", "b", "card", "x")).toEqual({ ok: true });
    await expect(setup({ write: { error: { code: "42501", message: "rls" } } }).allow("g1", "b", "card", "x")).rejects.toThrow("Couldn't save the Allow: rls");
  });
});

describe("parity with lib/connector-grant.ts", () => {
  it("has the same choices", () => {
    expect(grants.SCOPES).toEqual(shared.SCOPES);
    expect(grants.APPROVALS).toEqual(shared.APPROVALS);
    expect(grants.LIFETIMES).toEqual(shared.LIFETIMES);
    expect(grants.ASKS).toEqual(shared.ASKS);
  });

  const raws: unknown[] = [null, undefined, "x", 3, {}, { scope: "card" }, { scope: "nope", approval: "project", lifetime: "8h" }, { asks: [] }, { asks: ["protected_push", "protected_push", "x", 1] }, { asks: "protected_push" }, STRICT];
  it.each(raws.map((r) => [r]))("settingsOf(%j) agrees", (raw) => expect(grants.settingsOf(raw)).toEqual(shared.settingsOf(raw)));

  const all: shared.GrantSettings[] = [];
  for (const scope of shared.SCOPES) for (const approval of shared.APPROVALS) for (const lifetime of shared.LIFETIMES) for (const asks of [[], ["protected_push"]] as shared.Ask[][]) all.push({ scope, approval, lifetime, asks });
  it("looser agrees on every pair of settings", () => {
    let loose = 0;
    for (const was of all)
      for (const next of all) {
        const want = shared.looser(was, next);
        expect(grants.looser(was, next), `${JSON.stringify(was)} → ${JSON.stringify(next)}`).toBe(want);
        if (want) loose++;
      }
    expect(loose).toBeGreaterThan(0);
    expect(loose).toBeLessThan(all.length * all.length);
  });
});
