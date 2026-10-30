// The fetch / env / requestSecret operations for hosted data mini apps
// (docs/architecture/mini-app-hosting.md). The tests focus on the policy gate, the vault
// resolution, the env grant (a value leaves the vault for a filled fetch or weft.env only under one,
// which main asks Touch ID for itself when it's missing), and the IPC layer's frame check.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAppDataFetch, registerAppDataFetch } from "./app-data-fetch.cjs";
import { loadGrants, manifestHash, manifestNeeds } from "./app-data-grants.cjs";
import { frameEvent, makeApp, makeDataDir, makeVault } from "./app-data-test-helpers";
import type { Manifest } from "./app-data.cjs";

const FETCH_MANIFEST: Manifest = {
  name: "📈 Growth",
  folder: "/projects/x",
  env: "production",
  supabaseUrl: null,
  reads: {},
  secrets: {
    STRIPE_KEY: { hosts: ["api.stripe.com"], methods: ["GET"], paths: ["/v1/charges"] },
    OPENAI_KEY: { from: "viewer", hosts: ["api.openai.com"], methods: ["POST"], paths: ["/v1/responses"] },
  },
  public: ["SUPABASE_PUBLISHABLE_KEY"],
};

function lookupAllPublic(_host: string, _opts: unknown, cb: (err: unknown, addresses: { address: string; family: number }[] | null) => void) {
  cb(null, [{ address: "8.8.8.8", family: 4 }]);
}

function makeResponse({ status = 200, contentType = "application/json", body = "{}", headers = {} }: { status?: number; contentType?: string; body?: string; headers?: Record<string, string> } = {}) {
  const headerMap = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) headerMap.set(k.toLowerCase(), v);
  if (contentType) headerMap.set("content-type", contentType);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
      forEach: (cb: (value: string, name: string) => void) => {
        for (const [k, v] of headerMap.entries()) cb(v, k);
      },
    },
    body: {
      getReader: () => {
        const chunk = new Uint8Array(Buffer.from(body, "utf8"));
        let consumed = false;
        return {
          read: () => {
            if (consumed) return Promise.resolve({ value: undefined, done: true });
            consumed = true;
            return Promise.resolve({ value: chunk, done: false });
          },
          cancel: () => Promise.resolve(),
        };
      },
    },
    arrayBuffer: () => Promise.resolve(Buffer.from(body, "utf8").buffer.slice(Buffer.from(body, "utf8").byteOffset, Buffer.from(body, "utf8").byteOffset + Buffer.from(body, "utf8").byteLength)),
  };
}

describe("createAppDataFetch input shape", () => {
  it("throws when dataDir or vault are missing", () => {
    expect(() => createAppDataFetch({ dataDir: "", vault: makeVault() })).toThrow();
    expect(() => createAppDataFetch({ dataDir: "/tmp", vault: undefined })).toThrow();
  });
});

describe("weft.fetch: policy, fill, and vault resolution", () => {
  it("runs a placeholder-less request when the manifest's policy allows the host/method/path", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "growth", FETCH_MANIFEST);
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ body: '{"ok":true}' }));
    const ad = createAppDataFetch({ dataDir, vault: makeVault(), fetch: fetchMock, lookup: lookupAllPublic });
    const out = await ad.fetch(frameEvent({ url: a.url }), { url: "https://api.stripe.com/v1/charges", method: "GET" });
    expect(out.status).toBe(200);
    expect(out.body).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fills a placeholder from the vault and masks the echoed value in the response body", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "growth", FETCH_MANIFEST);
    const vault = makeVault({ values: { STRIPE_KEY: "sk_live_secret_42" } });
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ body: '{"client_secret":"sk_live_secret_42"}' }));
    const ad = createAppDataFetch({ dataDir, vault, fetch: fetchMock, lookup: lookupAllPublic });
    const out = await ad.fetch(frameEvent({ url: a.url }), {
      url: "https://api.stripe.com/v1/charges",
      method: "GET",
      headers: { authorization: "Bearer {{secret:STRIPE_KEY}}" },
    });
    expect(out.status).toBe(200);
    expect(out.body).toBe('{"client_secret":"‹STRIPE_KEY›"}');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk_live_secret_42");
  });

  it("refuses a request when a placeholder is missing in the vault (409)", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "growth", FETCH_MANIFEST);
    const fetchMock = vi.fn();
    const ad = createAppDataFetch({ dataDir, vault: makeVault({ values: {} }), fetch: fetchMock, lookup: lookupAllPublic });
    await expect(ad.fetch(frameEvent({ url: a.url }), {
      url: "https://api.stripe.com/v1/charges",
      method: "GET",
      headers: { authorization: "Bearer {{secret:STRIPE_KEY}}" },
    })).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a request to a host the policy doesn't allow (403)", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "growth", FETCH_MANIFEST);
    const fetchMock = vi.fn();
    const ad = createAppDataFetch({ dataDir, vault: makeVault(), fetch: fetchMock, lookup: lookupAllPublic });
    await expect(ad.fetch(frameEvent({ url: a.url }), { url: "https://example.com/", method: "GET" })).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a request when the host resolves to a private address (403)", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "growth", FETCH_MANIFEST);
    const fetchMock = vi.fn();
    const lookupPrivate = (_host: string, _opts: unknown, cb: (err: unknown, addresses: { address: string; family: number }[] | null) => void) => {
      cb(null, [{ address: "127.0.0.1", family: 4 }]);
    };
    const ad = createAppDataFetch({ dataDir, vault: makeVault(), fetch: fetchMock, lookup: lookupPrivate });
    await expect(ad.fetch(frameEvent({ url: a.url }), { url: "https://api.stripe.com/v1/charges", method: "GET" })).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a frame from outside a saved app's folder", async () => {
    const dataDir = makeDataDir();
    // Same folder, same manifest, but the saved app was never added to apps.json.
    const a = makeApp(dataDir, "growth", FETCH_MANIFEST, { saved: false });
    const ad = createAppDataFetch({ dataDir, vault: makeVault(), fetch: vi.fn(), lookup: lookupAllPublic });
    await expect(ad.fetch(frameEvent({ url: a.url }), { url: "https://api.stripe.com/v1/charges", method: "GET" })).rejects.toThrow("Save this page");
  });
});

describe("weft.env", () => {
  it("returns the values for the manifest's public names", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "growth", FETCH_MANIFEST);
    const vault = makeVault({ values: { SUPABASE_PUBLISHABLE_KEY: "sb_pub_x", UNRELATED: "no" } });
    const ad = createAppDataFetch({ dataDir, vault, fetch: vi.fn(), lookup: lookupAllPublic });
    const out = await ad.env(frameEvent({ url: a.url }));
    expect(out).toEqual({ SUPABASE_PUBLISHABLE_KEY: "sb_pub_x" });
  });

  it("returns an empty object when the manifest has no public names", async () => {
    const dataDir = makeDataDir();
    const m: Manifest = { ...FETCH_MANIFEST, public: [] };
    const a = makeApp(dataDir, "growth", m);
    const ad = createAppDataFetch({ dataDir, vault: makeVault(), fetch: vi.fn(), lookup: lookupAllPublic });
    const out = await ad.env(frameEvent({ url: a.url }));
    expect(out).toEqual({});
  });
});

// Threads may edit ~/.weft/apps, so a manifest naming a secret in `public` or `secrets` must not hand
// its value to the page without the user's yes (docs/architecture/secrets.md, 2026-10-29).
describe("the env grant behind fetch and env", () => {
  it("asks Touch ID once, naming every name, saves the grant and then stops asking", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "growth", FETCH_MANIFEST);
    const vault = makeVault({ values: { SUPABASE_PUBLISHABLE_KEY: "sb_pub_x" } });
    const confirm = vi.spyOn(vault, "confirm");
    const ad = createAppDataFetch({ dataDir, vault, fetch: vi.fn(), lookup: lookupAllPublic, now: () => 0 });
    await Promise.all([ad.env(frameEvent({ url: a.url })), ad.env(frameEvent({ url: a.url }))]);
    await ad.env(frameEvent({ url: a.url }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toBe("let 📈 Growth use you/repo's production env (OPENAI_KEY, STRIPE_KEY, SUPABASE_PUBLISHABLE_KEY)");
    const grant = Object.values(loadGrants(dataDir) as Record<string, unknown>)[0];
    expect(grant).toMatchObject({ env: "production", needs: ["OPENAI_KEY", "STRIPE_KEY", "SUPABASE_PUBLISHABLE_KEY"], readsHash: manifestHash(FETCH_MANIFEST) });
  });

  it("hands out nothing when the user says no", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "growth", FETCH_MANIFEST);
    const vault = makeVault({ values: { SUPABASE_PUBLISHABLE_KEY: "sb_pub_x", STRIPE_KEY: "sk_live_1" }, confirm: false });
    const valuesFor = vi.spyOn(vault, "valuesFor");
    const fetchMock = vi.fn();
    const ad = createAppDataFetch({ dataDir, vault, fetch: fetchMock, lookup: lookupAllPublic });
    await expect(ad.env(frameEvent({ url: a.url }))).rejects.toMatchObject({ kind: "not-granted" });
    await expect(ad.fetch(frameEvent({ url: a.url }), { url: "https://api.stripe.com/v1/charges", headers: { authorization: "Bearer {{secret:STRIPE_KEY}}" } })).rejects.toBeTruthy();
    expect(valuesFor).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loadGrants(dataDir)).toEqual({});
  });

  it("asks again when a manifest edit adds a public name to a granted app", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "growth", FETCH_MANIFEST);
    const vault = makeVault({ values: { SUPABASE_PUBLISHABLE_KEY: "sb_pub_x", SUPABASE_SECRET_KEY: "sb_secret_x" } });
    const confirm = vi.spyOn(vault, "confirm");
    const ad = createAppDataFetch({ dataDir, vault, fetch: vi.fn(), lookup: lookupAllPublic });
    await ad.env(frameEvent({ url: a.url }));
    const edited = { ...FETCH_MANIFEST, public: ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"] };
    fs.writeFileSync(path.join(a.folder, "weft-app.json"), JSON.stringify(edited));
    confirm.mockResolvedValueOnce(false);
    await expect(ad.env(frameEvent({ url: a.url }))).rejects.toMatchObject({ kind: "not-granted" });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1]?.[0]).toContain("SUPABASE_SECRET_KEY");
  });

  it("runs a fetch that fills no secret without asking", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "growth", FETCH_MANIFEST);
    const vault = makeVault();
    const confirm = vi.spyOn(vault, "confirm");
    const ad = createAppDataFetch({ dataDir, vault, fetch: vi.fn().mockResolvedValue(makeResponse()), lookup: lookupAllPublic });
    await ad.fetch(frameEvent({ url: a.url }), { url: "https://api.stripe.com/v1/charges" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("covers the reads' names, the fetch policy's and the public ones", () => {
    expect(manifestNeeds({ ...FETCH_MANIFEST, reads: { daily: { supabase: "growth_daily" } } })).toEqual(["OPENAI_KEY", "STRIPE_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]);
    expect(manifestNeeds({ ...FETCH_MANIFEST, reads: undefined as never, secrets: ["x"] as never, public: [1, "A"] as never })).toEqual(["A"]);
  });
});

describe("weft.requestSecret", () => {
  it("returns { set: true } when the vault has a value for a viewer secret", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "growth", FETCH_MANIFEST);
    const vault = makeVault({ values: { OPENAI_KEY: "sk-..." } });
    const ad = createAppDataFetch({ dataDir, vault, fetch: vi.fn(), lookup: lookupAllPublic });
    const out = await ad.requestSecret(frameEvent({ url: a.url }), "OPENAI_KEY");
    expect(out).toEqual({ set: true });
    expect(vault.blanks).toHaveLength(0);
  });

  it("adds the blank with a hint and returns { set: false } when the vault has no value", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "growth", FETCH_MANIFEST);
    const vault = makeVault({ values: {} });
    const ad = createAppDataFetch({ dataDir, vault, fetch: vi.fn(), lookup: lookupAllPublic });
    const out = await ad.requestSecret(frameEvent({ url: a.url }), "OPENAI_KEY");
    expect(out).toEqual({ set: false });
    expect(vault.blanks).toHaveLength(1);
    expect(vault.blanks[0]).toMatchObject({ folder: a.folder, names: ["OPENAI_KEY"], environments: ["production"] });
    expect(vault.blanks[0]?.hint).toContain("📈 Growth");
    expect(vault.blanks[0]?.hint).toContain("api.openai.com");
  });

  it("refuses a name that isn't a from: viewer secret in the manifest", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "growth", FETCH_MANIFEST);
    const ad = createAppDataFetch({ dataDir, vault: makeVault(), fetch: vi.fn(), lookup: lookupAllPublic });
    await expect(ad.requestSecret(frameEvent({ url: a.url }), "STRIPE_KEY")).rejects.toThrow(/isn't a viewer-provided secret/);
  });

  it("refuses a name that isn't in the manifest at all", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "growth", FETCH_MANIFEST);
    const ad = createAppDataFetch({ dataDir, vault: makeVault(), fetch: vi.fn(), lookup: lookupAllPublic });
    await expect(ad.requestSecret(frameEvent({ url: a.url }), "MADE_UP")).rejects.toThrow(/isn't in the manifest/);
  });
});

describe("the IPC layer", () => {
  it("refuses unless owns + mainFrame match, and routes each op to its handler", async () => {
    const dataDir = makeDataDir();
    const a = makeApp(dataDir, "growth", FETCH_MANIFEST);
    const vault = makeVault({ values: { STRIPE_KEY: "sk", SUPABASE_PUBLISHABLE_KEY: "pub" } });
    const fetchMock = vi.fn().mockResolvedValue(makeResponse({ body: "{}" }));
    const ad = createAppDataFetch({ dataDir, vault, fetch: fetchMock, lookup: lookupAllPublic });
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    const ipcMain = { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn) };
    const mainFrame = { url: a.url };
    const wc = { id: "wc", mainFrame };
    registerAppDataFetch(ipcMain, { appDataFetch: ad, owns: (sender) => sender === wc });

    const wrong = { sender: { id: "other", mainFrame }, senderFrame: mainFrame };
    await expect(handlers.get("app-data:fetch")!(wrong, { url: "https://api.stripe.com/v1/charges", method: "GET" })).rejects.toThrow("only answers the pane");
    const out = await handlers.get("app-data:env")!({ sender: wc, senderFrame: mainFrame });
    expect(out).toEqual({ SUPABASE_PUBLISHABLE_KEY: "pub" });
    const set = await handlers.get("app-data:request-secret")!({ sender: wc, senderFrame: mainFrame }, "OPENAI_KEY");
    expect(set).toEqual({ set: false });
    expect(vault.blanks).toHaveLength(1);
  });
});
