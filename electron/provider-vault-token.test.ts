import { describe, expect, it, vi } from "vitest";
import { createProviderVaultToken, wireProviderVaultToken } from "./provider-vault-token.cjs";

const SECRET = "vercel-secret-value-123";
const secrets = (...rows: [string, string, boolean?][]) => rows.map(([name, environment, missing]) => ({ name, environment, missing: Boolean(missing) }));

function make(opts: { vaults?: Record<string, { label: string; secrets: ReturnType<typeof secrets> }>; denied?: boolean; missing?: boolean; setToken?: () => Promise<unknown> } = {}) {
  const vaults = opts.vaults ?? { "/a": { label: "aimhuge/weft", secrets: secrets(["VERCEL_TOKEN", "production"], ["VERCEL_TOKEN", "development"], ["OTHER", "development"]) } };
  const setToken = vi.fn(opts.setToken ?? (() => Promise.resolve({ username: "alex" })));
  const vault = {
    names: vi.fn((folder: string) => (vaults[folder] ? Promise.resolve(vaults[folder]) : Promise.reject(new Error("no vault")))),
    sendValue: vi.fn(async (_f: string, _n: string, _e: string, reason: (l: string) => string, send: (v: string) => Promise<unknown>) => {
      if (opts.denied) return { denied: true, label: "aimhuge/weft" };
      if (opts.missing) return { missing: true, label: "aimhuge/weft" };
      reason("aimhuge/weft");
      await send(SECRET);
      return { label: "aimhuge/weft" };
    }),
  };
  const tokens = createProviderVaultToken({ vault, providers: { vercel: { setToken }, supabase: { setToken }, cloudflare: { setToken } } });
  return { tokens, vault, setToken };
}

describe("provider-vault-token candidates", () => {
  it("lists names only, preferring development, one per vault", async () => {
    const { tokens } = make({ vaults: { "/a": { label: "x/y", secrets: secrets(["VERCEL_API_TOKEN", "development"], ["VERCEL_TOKEN", "production"], ["VERCEL_TOKEN", "development"]) }, "/b": { label: "x/y", secrets: [] }, "/c": { label: "z/w", secrets: secrets(["VERCEL_TOKEN", "production"]) } } });
    expect(await tokens.candidates("vercel", ["/a", "/b", "/c", "/gone", 7 as never])).toEqual([
      { folder: "/a", label: "x/y", name: "VERCEL_TOKEN", environment: "development" },
      { folder: "/c", label: "z/w", name: "VERCEL_TOKEN", environment: "production" },
    ]);
  });

  it("skips blanks, preview values, other names, unknown providers and bad input", async () => {
    const { tokens } = make({ vaults: { "/a": { label: "x/y", secrets: secrets(["VERCEL_TOKEN", "development", true], ["VERCEL_TOKEN", "preview"]) } } });
    expect(await tokens.candidates("vercel", ["/a"])).toEqual([]);
    expect(await tokens.candidates("slack", ["/a"])).toEqual([]);
    expect(await tokens.candidates("vercel", "nope")).toEqual([]);
  });
});

describe("provider-vault-token adopt", () => {
  const pick = { folder: "/a", name: "VERCEL_TOKEN", environment: "development" };

  it("reads after Touch ID, hands the value to setToken and returns only the status", async () => {
    const { tokens, setToken, vault } = make();
    const result = await tokens.adopt("vercel", pick);
    expect(setToken).toHaveBeenCalledWith(SECRET);
    expect(result).toEqual({ status: { username: "alex" } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(vault.sendValue.mock.calls[0]![3]("aimhuge/weft")).toBe("use VERCEL_TOKEN (aimhuge/weft, development) as Weft's Vercel token");
  });

  it("changes nothing when Touch ID is denied or the value is gone", async () => {
    const denied = make({ denied: true });
    expect(await denied.tokens.adopt("vercel", pick)).toEqual({ denied: true });
    expect(denied.setToken).not.toHaveBeenCalled();
    const missing = make({ missing: true });
    expect(await missing.tokens.adopt("vercel", pick)).toEqual({ missing: true });
    expect(missing.setToken).not.toHaveBeenCalled();
  });

  it("refuses names and environments that aren't that provider's token", async () => {
    const { tokens, vault } = make();
    for (const bad of [{ ...pick, name: "OTHER" }, { ...pick, environment: "preview" }, { ...pick, folder: 3 }, undefined]) {
      await expect(tokens.adopt("vercel", bad as never)).rejects.toThrow("isn't a token");
    }
    await expect(tokens.adopt("slack", pick)).rejects.toThrow("isn't a token");
    expect(vault.sendValue).not.toHaveBeenCalled();
  });

  it("lets the provider's refusal through without the value", async () => {
    const { tokens } = make({ setToken: () => Promise.reject(new Error("Vercel said no")) });
    await expect(tokens.adopt("vercel", pick)).rejects.toThrow("Vercel said no");
  });

  it("names Supabase and Cloudflare in the prompt", async () => {
    const { tokens, vault } = make({ vaults: { "/a": { label: "a/b", secrets: secrets(["CF_API_TOKEN", "production"]) } } });
    await tokens.adopt("cloudflare", { folder: "/a", name: "CF_API_TOKEN", environment: "production" });
    expect(vault.sendValue.mock.calls[0]![3]("a/b")).toContain("Cloudflare token");
  });
});

describe("provider-vault-token IPC", () => {
  function wire(provider: string) {
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const ipcMain = { handle: (c: string, f: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(c, f) };
    const board = {};
    const { vault, setToken } = make();
    const wired = wireProviderVaultToken({ ipcMain, vault, board: () => board, provider, service: { setToken } });
    return { handlers, board, wired };
  }

  it("answers the board window only", async () => {
    const { handlers, board } = wire("vercel");
    expect([...handlers.keys()].sort()).toEqual(["vercel:use-vault-token", "vercel:vault-token-candidates"]);
    const list = handlers.get("vercel:vault-token-candidates")!;
    expect(await list({ sender: board }, ["/a"])).toHaveLength(1);
    expect(await handlers.get("vercel:use-vault-token")!({ sender: board }, { folder: "/a", name: "VERCEL_TOKEN", environment: "development" })).toEqual({ status: { username: "alex" } });
    expect(() => list({ sender: {} }, ["/a"])).toThrow("board window");
    expect(() => list({ sender: null }, ["/a"])).toThrow("board window");
  });

  it("offers nothing without a vault", () => {
    expect(wireProviderVaultToken({ ipcMain: { handle: vi.fn() }, vault: undefined, board: () => null, provider: "vercel", service: { setToken: vi.fn() } })).toBeNull();
  });
});
