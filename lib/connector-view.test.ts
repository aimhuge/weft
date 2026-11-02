// What Settings → Devices shows for each worker's connectors (lib/connector-view.ts), read through a fake Supabase
// client: grants, last use from the mint ledger, the Allows waiting, and weft.zip's word on GitHub.
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

const signedOut = vi.hoisted(() => ({ auth: { getSession: () => Promise.resolve({ data: { session: null } }) } }));
vi.mock("./account", () => ({ accountClient: () => signedOut }));

const { connectorsView } = await import("./connector-view");

type Result = { data: unknown; error: { message: string } | null };

// Every chain (select, eq, gte, order, limit, in) returns itself and resolves to its table's result.
function fakeClient(tables: Record<string, Result>, session: unknown = { access_token: "tok" }) {
  const calls: unknown[][] = [];
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "order", "limit", "in"]) q[m] = (...a: unknown[]) => (calls.push([table, m, ...a]), q);
    q.then = (ok: (r: Result) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(tables[table] ?? { data: null, error: null }).then(ok, bad);
    return q;
  };
  const client = { auth: { getSession: () => Promise.resolve({ data: { session } }) }, from: (t: string) => chain(t) };
  return { client: client as unknown as SupabaseClient, calls };
}

const NOW = Date.parse("2026-11-02T12:00:00Z");
const status = (body: unknown, ok = true) => vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: ok ? 200 : 500 })));
const remote = (fetchFn = status({ connected: true, login: "ada" })) => ({ fetchFn: fetchFn as unknown as typeof fetch, env: { WEFT_CONNECTOR_URL: "http://x.test" } });

const grant = (over: Record<string, unknown> = {}) => ({
  id: "g1",
  worker_id: "w1",
  scope: "installed",
  approval: "worker",
  lifetime: "revoked",
  asks: ["protected_push"],
  expires_at: null,
  last_used_at: "2026-11-02T11:00:00Z",
  ...over,
});
const mint = (over: Record<string, unknown> = {}) => ({ worker_id: "w1", card_id: "card-aaaa-1111", repo: "ada/app", outcome: "minted", at: "2026-11-02T11:00:00Z", ...over });

describe("connectorsView", () => {
  it("is empty when you're signed out, with the default client and Connect link", async () => {
    const v = await connectorsView();
    expect(v.connectUrl).toMatch(/\/api\/connectors\/github\/start$/);
    expect({ ...v, connectUrl: "" }).toEqual({ signedIn: false, github: { connected: false }, connectUrl: "", workers: {} });
  });

  it("maps each grant to its worker, with the latest minted repo as last use", async () => {
    const { client, calls } = fakeClient({
      connector_grants: { data: [grant(), grant({ id: "g2", worker_id: "w2", last_used_at: null })], error: null },
      connector_mints: { data: [mint({ repo: "ada/new" }), mint({ repo: "ada/old" }), mint({ worker_id: "w1", outcome: "refused", repo: "ada/x" })], error: null },
      connector_allows: { data: [], error: null },
    });
    const v = await connectorsView({ client, remote: remote(), now: NOW });
    expect(v.signedIn).toBe(true);
    expect(v.github).toEqual({ connected: true, login: "ada" });
    expect(v.connectUrl).toBe("http://x.test/api/connectors/github/start");
    expect(v.workers.w1).toEqual({
      grantId: "g1",
      settings: { scope: "installed", approval: "worker", lifetime: "revoked", asks: ["protected_push"] },
      expiresAt: null,
      lastUsedAt: "2026-11-02T11:00:00Z",
      lastRepo: "ada/new",
      pending: [],
    });
    expect(v.workers.w2).toMatchObject({ grantId: "g2", lastUsedAt: null, lastRepo: null, pending: [] });
    expect(calls).toContainEqual(["connector_mints", "gte", "at", new Date(NOW - 24 * 3_600_000).toISOString()]);
    expect(calls.some((c) => c[0] === "cloud_cards")).toBe(false);
  });

  it("folds weft.zip's error into github, and reads no rows as none", async () => {
    const { client } = fakeClient({ connector_grants: { data: null, error: null } });
    const v = await connectorsView({ client, remote: remote(status({ error: "GitHub connectors aren't set up on this server yet." }, false)), now: NOW });
    expect(v.github).toEqual({ connected: false, error: "GitHub connectors aren't set up on this server yet." });
    expect(v.workers).toEqual({});
  });

  it("lists the projects waiting for an Allow, once each, minus the ones allowed", async () => {
    const { client } = fakeClient({
      connector_grants: { data: [grant({ approval: "project" })], error: null },
      connector_mints: {
        data: [
          mint({ outcome: "needs_allow", repo: "ada/a" }),
          mint({ outcome: "needs_allow", repo: "ada/a" }),
          mint({ outcome: "needs_allow", repo: "ada/b" }),
          mint({ outcome: "needs_allow", repo: null }),
          mint({ outcome: "needs_allow", repo: "ada/c", worker_id: "w9" }),
        ],
        error: null,
      },
      connector_allows: { data: [{ grant_id: "g1", kind: "project", subject: "ada/b" }], error: null },
      cloud_cards: { data: null, error: null },
    });
    const v = await connectorsView({ client, remote: remote(), now: NOW });
    expect(v.workers.w1!.pending).toEqual([{ kind: "project", subject: "ada/a", label: "ada/a" }]);
  });

  it("labels cards waiting for an Allow by their titles, or a short id", async () => {
    const { client, calls } = fakeClient({
      connector_grants: { data: [grant({ approval: "card" })], error: null },
      connector_mints: {
        data: [mint({ outcome: "needs_allow", card_id: "c1" }), mint({ outcome: "needs_allow", card_id: "c2-0123456789" }), mint({ outcome: "needs_allow", card_id: "c3" }), mint({ outcome: "needs_allow", card_id: null })],
        error: null,
      },
      connector_allows: { data: null, error: null },
      cloud_cards: { data: [{ card_id: "c1", title: "Fix the login" }, { card_id: "c3", title: null }], error: null },
    });
    const v = await connectorsView({ client, remote: remote(), now: NOW });
    expect(v.workers.w1!.pending).toEqual([
      { kind: "card", subject: "c1", label: "Fix the login" },
      { kind: "card", subject: "c2-0123456789", label: "c2-01234" },
      { kind: "card", subject: "c3", label: "c3" },
    ]);
    expect(calls).toContainEqual(["cloud_cards", "in", "card_id", ["c1", "c2-0123456789", "c3"]]);
  });

  it("says why when the grants can't be read", async () => {
    const { client } = fakeClient({ connector_grants: { data: null, error: { message: "permission denied" } } });
    await expect(connectorsView({ client, remote: remote(), now: NOW })).rejects.toThrow("Couldn't read your connectors: permission denied");
  });
});
