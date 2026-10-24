// lib/app-read.ts: the hosted side of a mini app's reads. The reads themselves are electron/app-read-core.cjs
// (tested in electron/app-data-reads.test.ts); here, the status each refusal kind answers with and the
// hosted defaults (the global fetch, one GA4 token cache).
import { afterEach, describe, expect, it, vi } from "vitest";
import { readStatus, runHostedRead } from "./app-read";

const MANIFEST = { supabaseUrl: "https://abc.supabase.co" };
const ENTRY = { supabase: "growth_overview", args: { days: 7 } };

afterEach(() => vi.unstubAllGlobals());

describe("readStatus", () => {
  it("maps each refusal kind to its HTTP status", () => {
    const kinds: [string, number][] = [["bad-request", 400], ["manifest", 400], ["missing", 400], ["bad-args", 400], ["too-large", 413], ["timeout", 504], ["network", 502], ["upstream", 502]];
    for (const [kind, status] of kinds) expect(readStatus(Object.assign(new Error("x"), { kind }))).toBe(status);
  });

  it("keeps an upstream's own status", () => {
    expect(readStatus(Object.assign(new Error("x"), { kind: "upstream", status: 404 }))).toBe(404);
  });

  it("answers 500 for anything that isn't a read refusal", () => {
    expect(readStatus(new Error("boom"))).toBe(500);
    expect(readStatus(Object.assign(new Error("x"), { kind: "other" }))).toBe(500);
    expect(readStatus(null)).toBe(500);
    expect(readStatus("text")).toBe(500);
  });
});

describe("runHostedRead", () => {
  it("calls the function weft-app.json names, with the manifest's args as defaults", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runHostedRead(ENTRY, MANIFEST, {}, { SUPABASE_SECRET_KEY: "k" })).resolves.toEqual([]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://abc.supabase.co/rest/v1/rpc/growth_overview?days=7");
  });

  it("lets the page override a declared arg", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await runHostedRead(ENTRY, MANIFEST, { days: 30 }, { SUPABASE_SECRET_KEY: "k" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("days=30");
  });

  it("puts the refusal's status on the error it throws", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(runHostedRead(ENTRY, MANIFEST, {}, {})).rejects.toMatchObject({ kind: "missing", status: 400 });
    await expect(runHostedRead(ENTRY, { supabaseUrl: "https://attacker.example" }, {}, { SUPABASE_SECRET_KEY: "k" })).rejects.toMatchObject({ kind: "manifest", status: 400 });
  });

  it("leaves an error that isn't a refusal alone", async () => {
    vi.stubGlobal("fetch", vi.fn());
    // A manifest of null throws a TypeError reading supabaseUrl: not a read refusal, so no status.
    const err = await runHostedRead(ENTRY, null, {}, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect((err as { status?: unknown }).status).toBeUndefined();
  });

  it("runs a GA4 entry through the core", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(runHostedRead({ ga4: {} }, MANIFEST, undefined, {})).rejects.toMatchObject({ kind: "missing", status: 400 });
  });
});
