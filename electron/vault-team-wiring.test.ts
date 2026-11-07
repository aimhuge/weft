// The team-linked vault's wiring in electron/vault.cjs and electron/vault-ipc.cjs (docs/architecture/teams-vault.md,
// "A linked repo shares its vault"): the IPC channel, shareRepo finding a vault by its repo alone, and the overview's
// `linked` mark and background upkeep. The server is a fake Supabase; the crypto is real.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as sodium from "./vault-crypto.cjs";
import { createVault, registerVault } from "./vault.cjs";
import { hashOf } from "./vault-sync-files.cjs";

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(`w:${text}`),
  decryptString: (buf: Buffer) => buf.toString().slice(2),
};

type Rows = Record<string, unknown[]>;
type Rpcs = Record<string, unknown>;
type Result = { data: unknown; error: null };

// A chainable stand-in for supabase-js: from(table) answers that table's rows, rpc(name) its answer.
function fakeClient(tables: Rows, rpcs: Rpcs) {
  const rpc = vi.fn((name: string) => Promise.resolve<Result>({ data: rpcs[name] ?? null, error: null }));
  const upserts: { table: string; rows: unknown }[] = [];
  const from = (table: string) => {
    const rows = tables[table] ?? [];
    const query = {
      select: () => query,
      eq: () => query,
      limit: () => query,
      update: () => query,
      upsert: (r: unknown) => {
        upserts.push({ table, rows: r });
        return Promise.resolve<Result>({ data: null, error: null });
      },
      maybeSingle: () => Promise.resolve<Result>({ data: rows[0] ?? null, error: null }),
      then: (resolve: (r: Result) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return query;
  };
  const client = { supabase: { from, rpc }, signedIn: () => true, getClaims: () => ({ sub: "user-1" }) };
  return { client, rpc, upserts };
}

function make(client: unknown, { allow = true } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-team-wiring-"));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "weft-team-repo-"));
  const run = vi.fn((_folder: string, args: string[]) => Promise.resolve(args[0] === "remote" ? "git@github.com:Acme/Site.git" : ""));
  const prompt = vi.fn(() => Promise.resolve(allow));
  const notifyUser = vi.fn();
  const onChange = vi.fn();
  const clipboard = { writeText: vi.fn(), readText: () => "" };
  const vault = createVault({ dataDir, safeStorage, sodium, prompt, clipboard, run, onChange, accountClient: client as never, notifyUser });
  return { vault, dataDir, folder, prompt, notifyUser, onChange };
}

const ORGS = { orgs: [{ id: "o1", slug: "acme", name: "Acme" }], org_memberships: [{ org_id: "o1", user_id: "user-1", role: "member" }, { org_id: "o1", user_id: "user-2", role: "admin" }] };

describe("vault:share-repo", () => {
  const board = {};
  const ipc = () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    const ipcMain = { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn) };
    return { handlers, ipcMain };
  };
  const base = { grantPending: vi.fn(), declinePending: vi.fn(), requestJoin: vi.fn(), join: vi.fn(), shareLocal: vi.fn() };

  it("passes the team and repo through, with the signed-in client", async () => {
    const { handlers, ipcMain } = ipc();
    const shareRepo = vi.fn(() => Promise.resolve({ vaultId: "v1" }));
    const accountClient = { supabase: {} };
    registerVault(ipcMain, { vault: {}, isBoard: (s: unknown) => s === board, accountClient: () => accountClient, shared: { ...base, shareRepo } });
    expect(await handlers.get("vault:share-repo")!({ sender: board }, "o1", "Acme", "acme/site")).toEqual({ vaultId: "v1" });
    expect(shareRepo).toHaveBeenCalledWith({ orgId: "o1", orgName: "Acme", repo: "acme/site", accountClient });
    await handlers.get("vault:share-repo")!({ sender: board }, "o1", "", "acme/site");
    expect(shareRepo).toHaveBeenLastCalledWith({ orgId: "o1", orgName: undefined, repo: "acme/site", accountClient });
  });

  it("isn't there in a shell whose shared API has no shareRepo", () => {
    const { handlers, ipcMain } = ipc();
    registerVault(ipcMain, { vault: {}, isBoard: () => true, accountClient: () => ({}), shared: base });
    expect(handlers.has("vault:share-repo")).toBe(false);
  });
});

describe("shareRepo through createVault", () => {
  it("finds this Mac's vault by the repo alone and shares it after Touch ID", async () => {
    const { client, rpc, upserts } = fakeClient({ devices: [{ id: "device-1" }] }, { share_vault: "vault-1", trusted_vault_gaps: [] });
    const { vault, folder, prompt } = make(client);
    await vault.setValue(folder, "API_KEY", "development", "secret-value");
    const result = await (await vault.shared()).shareRepo({ orgId: "o1", orgName: "Acme", repo: "Acme/Site", accountClient: client });
    expect(result).toMatchObject({ vaultId: "vault-1", repo: "acme/site", secrets: 1, sealed: 0 });
    expect(prompt).toHaveBeenCalledWith("share 1 secret in Acme/Site with Acme");
    expect(rpc).toHaveBeenCalledWith("share_vault", expect.objectContaining({ p_org_id: "o1", p_repo: "acme/site", p_device_id: "device-1" }));
    // Ciphertext goes up, never the value.
    expect(upserts.some((u) => u.table === "vault_secrets")).toBe(true);
    expect(JSON.stringify(upserts)).not.toContain("secret-value");
  });

  it("does nothing for a repo with no vault on this Mac, or one already shared", async () => {
    const { client, rpc } = fakeClient({ devices: [{ id: "device-1" }] }, {});
    const { vault, folder, dataDir, prompt } = make(client);
    const api = await vault.shared();
    expect(await api.shareRepo({ orgId: "o1", repo: "acme/other", accountClient: client })).toEqual({ skipped: "none" });
    await vault.setValue(folder, "API_KEY", "development", "v");
    fs.writeFileSync(path.join(dataDir, "vault", `${hashOf("github:acme/site")}.shared.json`), JSON.stringify({ orgId: "o1", vaultId: "v9", repo: "acme/site", keyVersion: 1 }));
    expect(await api.shareRepo({ orgId: "o1", repo: "acme/site", accountClient: client })).toEqual({ skipped: "shared" });
    expect(prompt).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("share_vault", expect.anything());
  });
});

describe("overview with a team-linked repo", () => {
  it("marks the vault with its team and asks to join it in the background", async () => {
    const { client, rpc } = fakeClient(
      { ...ORGS, vaults: [{ id: "v1", org_id: "o1", repo: "acme/site" }], vault_grants: [], pending_device_grants: [], devices: [{ id: "device-1" }] },
      { pending_vault_devices: [], team_orgs_for_repos: [{ repo: "Acme/Site", org_id: "o1" }], request_vault_device: "p1", trusted_vault_gaps: [] },
    );
    const { vault, folder, onChange, notifyUser } = make(client);
    const overview = await vault.overview([folder]);
    expect(overview.vaults[0]).toMatchObject({ linked: { orgId: "o1", name: "Acme" }, join: { vaultId: "v1", state: "none" } });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(folder));
    expect(rpc).toHaveBeenCalledWith("request_vault_device", { p_vault_id: "v1", p_device_id: "device-1" });
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it("tells an admin about a Mac waiting on the team's vault", async () => {
    const waiting = [{ id: "r1", vault_id: "v1", person: "Sam", device_name: "Sam's Air", fingerprint: "ab" }];
    const { client } = fakeClient({ ...ORGS, vaults: [], vault_grants: [], pending_device_grants: [], devices: [{ id: "device-1" }] }, { pending_vault_devices: waiting, team_orgs_for_repos: [], trusted_vault_gaps: [] });
    const { vault, folder, notifyUser } = make(client);
    const overview = await vault.overview([folder]);
    expect(overview.vaults[0]?.linked).toBeUndefined();
    await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Sam asks to add Sam's Air") as unknown })));
  });

  it("skips the team's chores when signed out", async () => {
    const { vault, folder } = make(null);
    const overview = await vault.overview([folder]);
    expect(overview.vaults[0]?.linked).toBeUndefined();
  });
});
