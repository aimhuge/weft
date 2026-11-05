import { beforeAll, describe, expect, it, vi } from "vitest";
import { acceptGrant, cryptoReady } from "./vault-grant.cjs";
import { importSecrets, shareLocalVault } from "./vault-share.cjs";
import { createSharedApi } from "./vault-shared-api.cjs";
import { registerVault } from "./vault-ipc.cjs";
import { fingerprint } from "./device-fingerprint.cjs";
import { fakeSupabase, rowFor } from "./vault-grant.harness";
import * as sodium from "./vault-crypto.cjs";

beforeAll(async () => {
  await cryptoReady(sodium);
  await sodium.ready();
});

describe("shareLocalVault", () => {
  it("keeps the local key as version 1 and imports the local rows as ciphertext", async () => {
    const mine = sodium.newKeypair();
    const key = sodium.newVaultKey();
    const box = sodium.encrypt("sk_test_0123456789", key, sodium.aad("github:owner/name", "API_KEY", "development", 1)); // gitleaks:allow
    const { written, client } = fakeSupabase({ rpc: "vault-9" });

    const marked: { id: string; value: Record<string, unknown> }[] = [];
    const result = await shareLocalVault({
      accountClient: client,
      orgId: "org-1",
      repo: "Owner/Name",
      label: "weft",
      device: { id: "device-1", publicKey: mine.publicKey },
      vault: { id: "github:owner/name", key, keyVersion: 1, secrets: [{ name: "API_KEY", environment: "development", ciphertext: box.ciphertext, nonce: box.nonce, keyVersion: 1 }] },
      markShared: (id: string, value: Record<string, unknown>) => marked.push({ id, value }),
      sodium,
    });

    expect(result.vaultId).toBe("vault-9");
    expect(result.repo).toBe("owner/name");
    expect(result.keyVersion).toBe(1);

    // The RPC got the sealed key, not the key.
    const call = rowFor(written, "rpc") as { p_wrapped_key: string; p_repo: string; p_device_id: string };
    expect(call.p_wrapped_key).not.toBe(key);
    expect(call.p_repo).toBe("owner/name");
    expect(call.p_device_id).toBe("device-1");
    expect(acceptGrant({ vault: { id: "github:owner/name", key }, myDevice: mine, wrappedKey: call.p_wrapped_key }).key).toBe(key);

    // The secrets went up as the ciphertext they already were.
    const rows = rowFor(written, "vault_secrets") as { ciphertext: string; key_version: number; is_blank: boolean }[];
    expect(rows[0]?.ciphertext).toBe(box.ciphertext);
    expect(rows[0]?.key_version).toBe(1);
    expect(rows[0]?.is_blank).toBe(false);
    expect(JSON.stringify(written)).not.toContain("sk_test_0123456789"); // gitleaks:allow

    // The local file is now a shadow of the server's vault.
    expect(marked).toEqual([{ id: "github:owner/name", value: { orgId: "org-1", vaultId: "vault-9", repo: "owner/name", keyVersion: 1 } }]);
  });

  it("marks a blank as a blank, with its hint and no ciphertext", async () => {
    const mine = sodium.newKeypair();
    const { written, client } = fakeSupabase();
    await shareLocalVault({
      accountClient: client,
      orgId: "org-1",
      repo: "owner/name",
      device: { id: "device-1", publicKey: mine.publicKey },
      vault: { id: "github:owner/name", key: sodium.newVaultKey(), keyVersion: 1, secrets: [{ name: "TODO", environment: "development", hint: "From the provider" }] },
      sodium,
    });
    const rows = rowFor(written, "vault_secrets") as { is_blank: boolean; ciphertext: null; hint: string }[];
    expect(rows[0]?.is_blank).toBe(true);
    expect(rows[0]?.ciphertext).toBeNull();
    expect(rows[0]?.hint).toBe("From the provider");
  });

  it("refuses a repo name that isn't owner/name, and one that isn't a repo", async () => {
    const mine = sodium.newKeypair();
    const { client } = fakeSupabase();
    const vault = { id: "github:owner/name", key: sodium.newVaultKey(), keyVersion: 1 };
    const base = { accountClient: client, orgId: "org-1", device: { id: "device-1", publicKey: mine.publicKey }, vault, sodium };
    await expect(shareLocalVault({ ...base, repo: "not-a-repo" })).rejects.toThrow(/owner\/name/);
    await expect(shareLocalVault({ ...base, repo: "owner/name", checkRepo: () => Promise.resolve(false) })).rejects.toThrow(/isn't a GitHub repository/);
  });

  it("refuses without a signed-in user", async () => {
    const mine = sodium.newKeypair();
    const { client } = fakeSupabase();
    await expect(
      shareLocalVault({
        accountClient: { ...client, getClaims: () => null },
        orgId: "org-1",
        repo: "owner/name",
        device: { id: "device-1", publicKey: mine.publicKey },
        vault: { id: "github:owner/name", key: sodium.newVaultKey(), keyVersion: 1 },
        sodium,
      }),
    ).rejects.toThrow(/Sign in/);
  });
});

describe("importSecrets", () => {
  it("writes nothing when there are no secrets", async () => {
    const { written, client } = fakeSupabase();
    expect(await importSecrets({ accountClient: client, vaultId: "v", secrets: [], keyVersion: 1, userId: "user-1" })).toBe(0);
    expect(written).toHaveLength(0);
  });
});

describe("shareLocalVault against a vault the workspace already has", () => {
  const share = (client: ReturnType<typeof fakeSupabase>["client"]) => {
    const mine = sodium.newKeypair();
    return shareLocalVault({
      accountClient: client,
      orgId: "org-1",
      repo: "owner/name",
      device: { id: "device-2", publicKey: mine.publicKey },
      vault: { id: "github:owner/name", key: sodium.newVaultKey(), keyVersion: 1, secrets: [{ name: "API_KEY", environment: "development", ciphertext: "a-different-key", nonce: "n", keyVersion: 1 }] },
      sodium,
    });
  };

  it("refuses a second Mac, whose key would leave rows nobody can open", async () => {
    const { written, client } = fakeSupabase({ vault: { id: "vault-1", current_key_version: 1 } });
    await expect(share(client)).rejects.toThrow(/already shared/);
    expect(written).toHaveLength(0);
  });

  it("lets the Mac that holds a grant finish a share that stopped halfway", async () => {
    const { written, client } = fakeSupabase({ vault: { id: "vault-1", current_key_version: 1 }, grant: { id: "g" } });
    (client.supabase.from("vault_grants") as { select: () => { limit: () => unknown } }).select = () => ({ eq() { return this; }, limit: () => Promise.resolve({ data: [{ id: "g" }], error: null }) }) as never;
    await share(client);
    expect(rowFor(written, "vault_secrets")).toBeTruthy();
  });

  it("keeps a lower-case name on this Mac and says so", async () => {
    const mine = sodium.newKeypair();
    const { written, client } = fakeSupabase();
    const result = await shareLocalVault({
      accountClient: client,
      orgId: "org-1",
      repo: "owner/name",
      device: { id: "device-1", publicKey: mine.publicKey },
      vault: { id: "github:owner/name", key: sodium.newVaultKey(), keyVersion: 1, secrets: [{ name: "lower_key", environment: "development", hint: "x" }, { name: "UPPER", environment: "development", hint: "y" }] },
      sodium,
    });
    expect(result.keptLocal).toEqual(["lower_key"]);
    expect((rowFor(written, "vault_secrets") as { name: string }[]).map((r) => r.name)).toEqual(["UPPER"]);
  });
});

describe("createSharedApi", () => {
  it("seals the key and marks the local file shared, without the key in any of it", async () => {
    const mine = sodium.newKeypair();
    const theirs = sodium.newKeypair();
    const key = sodium.newVaultKey();
    const { written, client } = fakeSupabase({
      pending: { id: "pending-1", vault_id: "vault-1", status: "accepted", matched_device_id: "device-2", target_public_key: theirs.publicKey, target_fingerprint: fingerprint(theirs.publicKey) },
      rpc: "device-2",
    });
    const prompt = vi.fn(() => Promise.resolve(true));
    const api = createSharedApi({
      readVault: () => Promise.reject(new Error("a server id isn't a folder")),
      readServerVault: () => Promise.resolve({ localId: "github:owner/name", label: "owner/name", key, keyVersion: 1 }),
      device: { id: "device-1", publicKey: mine.publicKey },
      sodium,
      prompt,
    });

    const granted = await api.grantPending({ pendingId: "pending-1", accountClient: client });
    expect(granted).toMatchObject({ deviceId: "device-2" });

    expect(prompt).toHaveBeenCalledOnce();
    const call = rowFor(written, "rpc") as { p_wrapped_key: string };
    expect(call.p_wrapped_key).not.toBe(key);
    expect(acceptGrant({ vault: { key }, myDevice: theirs, wrappedKey: call.p_wrapped_key }).key).toBe(key);
  });

  it("seals nothing when Touch ID says no", async () => {
    const theirs = sodium.newKeypair();
    const { written, client } = fakeSupabase({ pending: { id: "p", vault_id: "vault-1", status: "accepted", matched_device_id: "d", target_public_key: theirs.publicKey, target_fingerprint: fingerprint(theirs.publicKey) } });
    const api = createSharedApi({
      readVault: () => Promise.reject(new Error("unused")),
      readServerVault: () => Promise.resolve({ label: "owner/name", key: sodium.newVaultKey(), keyVersion: 1 }),
      device: { id: "device-1", publicKey: sodium.newKeypair().publicKey },
      sodium,
      prompt: () => Promise.resolve(false),
    });
    expect(await api.grantPending({ pendingId: "p", accountClient: client })).toEqual({ denied: true });
    expect(written).toHaveLength(0);
  });

  it("asks to join, declines, and opens an approved grant into the store", async () => {
    const mine = sodium.newKeypair();
    const key = sodium.newVaultKey();
    const { written, client } = fakeSupabase({ grant: { key_version: 3, wrapped_key: sodium.wrapKey(key, mine.publicKey) }, rpc: "pending-9" });
    const adopt = vi.fn(() => Promise.resolve({}));
    const api = createSharedApi({ readVault: () => Promise.reject(new Error("unused")), adopt, device: { id: "device-1", ...mine }, sodium });

    expect(await api.requestJoin({ vaultId: "vault-1", accountClient: client })).toEqual({ pendingId: "pending-9" });
    expect(written[0]).toMatchObject({ op: "request_vault_device", row: { p_vault_id: "vault-1", p_device_id: "device-1" } });
    expect(await api.declinePending({ pendingId: "pending-9", accountClient: client })).toEqual({ declined: true });

    const joined = await api.join({ folder: "/repo", vaultId: "vault-1", orgId: "org-1", repo: "owner/name", accountClient: client });
    expect(joined).toEqual({ joined: true, keyVersion: 3 });
    expect(adopt).toHaveBeenCalledWith("/repo", expect.objectContaining({ key, keyVersion: 3 }), { orgId: "org-1", vaultId: "vault-1", repo: "owner/name", keyVersion: 3 });
  });

  it("shares a local vault and marks it shared next to its file", async () => {
    const mine = sodium.newKeypair();
    const key = sodium.newVaultKey();
    const { written, client } = fakeSupabase({ rpc: "vault-9" });
    const marked: { id: string; value: Record<string, unknown> }[] = [];
    const api = createSharedApi({
      readVault: () => Promise.resolve({ id: "github:owner/name", localId: "github:owner/name", label: "owner/name", key, keyVersion: 1, secrets: [] }),
      device: { id: "device-1", publicKey: mine.publicKey },
      sodium,
      sync: { markShared: (id: string, value: Record<string, unknown>) => marked.push({ id, value }) },
    });

    const result = await api.shareLocal({ folder: "/repo", orgId: "org-1", repo: "owner/name", accountClient: client });
    expect(result.vaultId).toBe("vault-9");
    expect(marked[0]?.value).toEqual({ orgId: "org-1", vaultId: "vault-9", repo: "owner/name", keyVersion: 1 });
    // The key never made it into a call.
    expect(JSON.stringify(written)).not.toContain(key);
  });
});

describe("the device-grant IPC channel", () => {
  const board = {};
  const shared = () => ({
    grantPending: vi.fn(() => Promise.resolve({ deviceId: "device-2" })),
    shareLocal: vi.fn(() => Promise.resolve({ vaultId: "vault-9" })),
    declinePending: vi.fn(),
    requestJoin: vi.fn(),
    join: vi.fn(),
  });

  it("has a channel of its own, apart from the thread grant", () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    const ipcMain = { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn) };
    const vault = { grant: vi.fn(), grantList: vi.fn() };
    const accountClient = { supabase: {}, getClaims: () => ({ sub: "user-1" }) };

    registerVault(ipcMain, { vault, isBoard: (sender: unknown) => sender === board, accountClient: () => accountClient, shared: shared() });

    // The two are different things: `vault:grant` gives a card's thread access to a local vault for
    // an hour; `vault:device-grant` seals the vault key to a teammate's machine.
    expect(handlers.has("vault:grant")).toBe(true);
    expect(handlers.has("vault:device-grant")).toBe(true);
    expect(handlers.get("vault:grant")).not.toBe(handlers.get("vault:device-grant"));
    expect(handlers.has("vault:share")).toBe(true);
  });

  it("passes the pending id and the signed-in client through, and answers only the board", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    const ipcMain = { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn) };
    const vault = { grant: vi.fn(), grantList: vi.fn() };
    const calls = shared();
    const accountClient = { supabase: {}, getClaims: () => ({ sub: "user-1" }) };

    registerVault(ipcMain, { vault, isBoard: (sender: unknown) => sender === board, accountClient: () => accountClient, shared: calls });
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({ sender: board }, ...args);

    expect(await call("vault:device-grant", "pending-1")).toEqual({ deviceId: "device-2" });
    expect(calls.grantPending).toHaveBeenCalledWith({ pendingId: "pending-1", accountClient });

    expect(await call("vault:share", "/repo", "org-1", "owner/name")).toEqual({ vaultId: "vault-9" });
    expect(calls.shareLocal).toHaveBeenCalledWith({ folder: "/repo", orgId: "org-1", repo: "owner/name", label: undefined, accountClient });

    // Anyone but the board window is refused.
    await expect(handlers.get("vault:device-grant")!({ sender: {} }, "pending-1")).rejects.toThrow(/board window/);
  });

  it("isn't registered at all on a desktop with no signed-in user", () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    const ipcMain = { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn) };
    const vault = { grant: vi.fn(), grantList: vi.fn() };
    registerVault(ipcMain, { vault, isBoard: () => true });
    expect(handlers.has("vault:device-grant")).toBe(false);
    expect(handlers.has("vault:share")).toBe(false);
  });
});
