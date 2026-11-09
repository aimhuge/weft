import { describe, expect, it, vi } from "vitest";

// The growth read in Electron main (electron/growth-read.cjs): the numbers the daily summary posts, read
// with the service key in the vault. The key stays in main — only rows go back to the server.

const { growthRoutes, vaultFor, DEFAULT_VAULT } = await import("./growth-read.cjs");

// A vault whose one name has a value, and a record of what was asked of it.
function makeVault(options: { values?: Record<string, string>; missing?: string[] } = {}) {
  const values = options.values ?? { SUPABASE_SECRET_KEY: "sb_secret_x" };
  const missing = options.missing ?? [];
  return {
    reads: [] as Array<{ where: string; names: string[]; environment: string }>,
    valuesFor(folder: string, names: string[], environment: string) {
      this.reads.push({ where: folder, names, environment });
      const found = Object.fromEntries(Object.entries(values).filter(([name]) => names.includes(name)));
      return { id: "github:aimhuge/weft", label: "aimhuge/weft", values: found, missing };
    },
    valuesForVault(vault: { id: string; label: string }, names: string[], environment: string) {
      this.reads.push({ where: vault.id, names, environment });
      const found = Object.fromEntries(Object.entries(values).filter(([name]) => names.includes(name)));
      return { id: vault.id, label: vault.label, values: found, missing };
    },
  };
}

// A fetch that answers PostgREST with the given body, and records the request it got.
function makeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = vi.fn((url: string | URL, init: { headers: Record<string, string> }) => {
    calls.push({ url: String(url), headers: init.headers });
    return Promise.resolve({
      ok: status < 400,
      status,
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("the growth read in main", () => {
  it("reads the numbers with the vault's key and answers with rows", async () => {
    const vault = makeVault();
    const { fetchImpl, calls } = makeFetch({ accounts: 12, new_7d: 3 });
    const route = growthRoutes(() => vault, fetchImpl)["POST /growth/read"];
    const answer = await route({ fn: "growth_overview", args: {} });
    expect(answer).toEqual({ rows: { accounts: 12, new_7d: 3 } });
    // The key went in the headers, to Supabase's host and nowhere else.
    expect(calls[0]?.url).toBe("https://lqjyravglujyizyqypxq.supabase.co/rest/v1/rpc/growth_overview");
    expect(calls[0]?.headers.apikey).toBe("sb_secret_x");
  });

  it("never answers with the key itself", async () => {
    const vault = makeVault();
    const { fetchImpl } = makeFetch({ accounts: 1 });
    const route = growthRoutes(() => vault, fetchImpl)["POST /growth/read"];
    const answer = await route({ fn: "growth_overview", args: {} });
    expect(JSON.stringify(answer)).not.toContain("sb_secret_x");
  });

  it("reads the events since the time it was given", async () => {
    const vault = makeVault();
    const { fetchImpl, calls } = makeFetch([{ kind: "user", id: "u1", at: "2026-11-01T00:00:00Z" }]);
    const route = growthRoutes(() => vault, fetchImpl)["POST /growth/read"];
    const answer = await route({ fn: "growth_events", args: { since: "2026-11-01T00:00:00Z" } });
    expect(answer).toEqual({ rows: [{ kind: "user", id: "u1", at: "2026-11-01T00:00:00Z" }] });
    expect(calls[0]?.url).toContain("since=2026-11-01T00%3A00%3A00Z");
  });

  it("refuses a function that isn't one of the growth reads", async () => {
    // The route is a way to reach the database with a service key: only these two functions may be called.
    const vault = makeVault();
    const { fetchImpl, calls } = makeFetch({});
    const route = growthRoutes(() => vault, fetchImpl)["POST /growth/read"];
    await expect(route({ fn: "delete_everything" })).rejects.toThrow("can't read");
    expect(calls).toHaveLength(0);
  });

  it("says so when the vault has no key for it", async () => {
    const vault = makeVault({ values: {}, missing: ["SUPABASE_SECRET_KEY"] });
    const { fetchImpl, calls } = makeFetch({});
    const route = growthRoutes(() => vault, fetchImpl)["POST /growth/read"];
    await expect(route({ fn: "growth_overview" })).rejects.toThrow("no value in aimhuge/weft · production");
    expect(calls).toHaveLength(0);
  });

  it("reads the key from the environment the caller names", async () => {
    const vault = makeVault();
    const { fetchImpl } = makeFetch({ accounts: 1 });
    const route = growthRoutes(() => vault, fetchImpl)["POST /growth/read"];
    await route({ fn: "growth_overview", args: {}, environment: "preview" });
    expect(vault.reads[0]?.environment).toBe("preview");
  });

  it("says so when the vault isn't ready yet", async () => {
    const { fetchImpl } = makeFetch({});
    const route = growthRoutes(() => null, fetchImpl)["POST /growth/read"];
    await expect(route({ fn: "growth_overview" })).rejects.toThrow("vault isn't ready");
  });

  it("says what Supabase answered when it refuses", async () => {
    const vault = makeVault();
    const { fetchImpl } = makeFetch({ message: "permission denied" }, 403);
    const route = growthRoutes(() => vault, fetchImpl)["POST /growth/read"];
    await expect(route({ fn: "growth_overview" })).rejects.toThrow("permission denied");
  });
});

describe("which vault the key comes from", () => {
  it("is Weft's own vault by default", () => {
    expect(vaultFor("")).toEqual({ vault: DEFAULT_VAULT });
  });

  it("is the folder the caller names", () => {
    expect(vaultFor("/Users/me/dev/weft")).toEqual({ folder: "/Users/me/dev/weft" });
  });

  it("is the vault WEFT_VAULT_ID names, as a vault and not a folder", () => {
    // A fork: its remote is its own vault id, and the read must be able to open it.
    const before = process.env.WEFT_VAULT_ID;
    process.env.WEFT_VAULT_ID = "github:someone/weft";
    try {
      expect(vaultFor("")).toEqual({ vault: { id: "github:someone/weft", label: "someone/weft" } });
    } finally {
      if (before === undefined) delete process.env.WEFT_VAULT_ID;
      else process.env.WEFT_VAULT_ID = before;
    }
  });
});
