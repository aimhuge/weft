import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as sodium from "./vault-crypto.cjs";
import { createVault } from "./vault.cjs";
import { loadDeviceKey } from "./device-key.cjs";

// The 🔐 drawer's line for why a vault has no "Ask to join" (docs/architecture/teams-vault.md), end to end
// through vault.overview. The reasons themselves are tested in vault-team.test.ts.
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};

function overview(accountClient: unknown) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-data-"));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "weft-proj-"));
  const run = () => Promise.resolve("git@github.com:Owner/Repo.git");
  const vault = createVault({ dataDir, safeStorage, sodium, prompt: vi.fn(), clipboard: { writeText: vi.fn(), readText: () => "" }, run, accountClient: accountClient as null });
  return { dataDir, vault, result: vault.overview([folder]).finally(() => vault.close()) };
}

describe("vault.overview's join hint", () => {
  it("says this Mac is signed out, without making a device key", async () => {
    const { dataDir, result } = overview({ signedIn: () => false, supabase: {} });
    expect((await result).vaults[0]).toMatchObject({ id: "github:owner/repo", joinHint: "signed-out" });
    expect(fs.existsSync(path.join(dataDir, "device-key.json"))).toBe(false);
  });

  it("says it couldn't check when the server fails", async () => {
    const { result } = overview({ signedIn: () => true, supabase: { from: () => { throw new Error("offline"); } } });
    expect((await result).vaults[0]!.joinHint).toBe("error");
  });

  it("says nothing in a shell with no account client", async () => {
    const { result } = overview(null);
    expect((await result).vaults[0]!.joinHint).toBeUndefined();
  });
});

// A server where every read answers nothing, except this Mac's own devices row.
function revokedServer(publicKey: () => string) {
  const builder = (table: string): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "not", "order", "limit"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: table === "devices" ? { id: "d1", public_key: publicKey(), revoked_at: "2026-11-05T00:00:00Z" } : null, error: null });
    b.then = (done: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(done);
    return b;
  };
  return { signedIn: () => true, getClaims: () => ({ sub: "user-1" }), supabase: { from: builder, rpc: () => Promise.resolve({ data: [], error: null }) } };
}

describe("vault.overview and a removed Mac", () => {
  it("says this Mac was removed, on the vault and in the overview, and Re-add asks for Touch ID first", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-data-"));
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "weft-proj-"));
    await sodium.ready();
    const key = loadDeviceKey({ dir: dataDir, safeStorage, crypto: sodium });
    const prompt = vi.fn(() => Promise.resolve(false));
    const run = () => Promise.resolve("git@github.com:Owner/Repo.git");
    const vault = createVault({ dataDir, safeStorage, sodium, prompt, clipboard: { writeText: vi.fn(), readText: () => "" }, run, accountClient: revokedServer(() => key.publicKey) as unknown as null });
    const result = await vault.overview([folder]);
    expect(result.device).toEqual({ state: "revoked", revokedAt: "2026-11-05T00:00:00Z" });
    expect(result.vaults[0]!.joinHint).toBe("revoked");
    expect(await vault.readd()).toEqual({ denied: true });
    expect(prompt).toHaveBeenCalledWith("re-add this Mac to your account with a new key");
    expect(loadDeviceKey({ dir: dataDir, safeStorage, crypto: sodium }).publicKey).toBe(key.publicKey);
    vault.close();
  });
});
