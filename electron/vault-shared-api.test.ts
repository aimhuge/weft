// createSharedApi's team-link calls: sealTrusted, shareRepo, and grantPending's seal afterwards.
// The rest of createSharedApi is in electron/vault-share.test.ts.
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { acceptGrant, cryptoReady } from "./vault-grant.cjs";
import { createSharedApi } from "./vault-shared-api.cjs";
import { fingerprint } from "./device-fingerprint.cjs";
import { fakeSupabase, type FakeOptions } from "./vault-grant.harness";
import * as sodium from "./vault-crypto.cjs";

beforeAll(async () => {
  await cryptoReady(sodium);
  // vault-shared-api.cjs requires its own copy of vault-grant.cjs; sealTrusted's wrap needs that copy ready too
  // (in the app, readServerVault's readLocalVault readies it first).
  const required = createRequire(import.meta.url)("./vault-grant.cjs") as { cryptoReady: typeof cryptoReady };
  await required.cryptoReady(sodium);
  await sodium.ready();
});

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

// The harness's client, with some rpc names answered here instead; every call is still recorded.
const withRpc = (answers: Record<string, Rpc>, opts: FakeOptions = {}) => {
  const fake = fakeSupabase(opts);
  const base = fake.client.supabase.rpc;
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    if (!answers[name]) return base(name, args);
    fake.written.push({ table: "rpc", op: name, row: args });
    return answers[name](name, args);
  });
  return { ...fake, rpc, client: { ...fake.client, supabase: { ...fake.client.supabase, rpc } } };
};
const ok = (data: unknown): Rpc => () => Promise.resolve({ data, error: null });
const calls = (written: { op: string; row: Record<string, unknown> }[], op: string) => written.filter((w) => w.op === op).map((w) => w.row);

describe("sealTrusted", () => {
  const me = () => ({ id: "device-1", publicKey: sodium.newKeypair().publicKey });
  type ServerVault = { localId?: string; key: string; keyVersion: number; label: string };
  const unread = () => Promise.resolve({ key: "", keyVersion: 1, label: "" });
  const api = (readServerVault?: (id: string) => Promise<ServerVault>) => createSharedApi({ readVault: () => Promise.reject(new Error("unused")), readServerVault, device: me(), sodium });

  it("seals nothing without a client or a way to read the server's vault", async () => {
    expect(await api(unread).sealTrusted({ accountClient: null })).toEqual({ sealed: 0 });
    const { client, rpc } = withRpc({});
    expect(await api(undefined).sealTrusted({ accountClient: client })).toEqual({ sealed: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("seals nothing on an rpc error or with no gaps", async () => {
    const failing = withRpc({ trusted_vault_gaps: () => Promise.resolve({ data: null, error: { message: "no" } }) });
    expect(await api(unread).sealTrusted({ accountClient: failing.client })).toEqual({ sealed: 0 });
    const empty = withRpc({ trusted_vault_gaps: ok([]) });
    expect(await api(unread).sealTrusted({ accountClient: empty.client })).toEqual({ sealed: 0 });
  });

  it("seals each gap it can, and counts only the grants the server took", async () => {
    const key = sodium.newVaultKey();
    const theirs = sodium.newKeypair();
    const gap = (vault: string, device: string, version = 1) => ({ vault_id: vault, device_id: device, public_key: theirs.publicKey, key_version: version });
    let grants = 0;
    const { client, written } = withRpc({
      trusted_vault_gaps: ok([gap("v-ok", "d1"), gap("v-missing", "d2"), gap("v-old", "d3", 1), gap("v-ok", "d4"), gap("v-ok", "d5")]),
      grant_trusted_vault_device: () => {
        grants += 1;
        if (grants === 2) return Promise.resolve({ data: null, error: { message: "key moved" } });
        if (grants === 3) return Promise.reject(new Error("offline"));
        return Promise.resolve({ data: null, error: null });
      },
    });
    const readServerVault = vi.fn((id: string) => {
      if (id === "v-missing") return Promise.reject(new Error("not on this Mac"));
      return Promise.resolve({ key, keyVersion: id === "v-old" ? 2 : ("1" as unknown as number), label: id });
    });

    expect(await api(readServerVault).sealTrusted({ accountClient: client })).toEqual({ sealed: 1 });
    const sent = calls(written, "grant_trusted_vault_device") as { p_vault_id: string; p_device_id: string; p_wrapped_key: string; p_key_version: number }[];
    expect(sent.map((s) => s.p_device_id)).toEqual(["d1", "d4", "d5"]);
    expect(sent[0]!).toMatchObject({ p_vault_id: "v-ok", p_key_version: 1 });
    expect(sent[0]!.p_wrapped_key).not.toBe(key);
    expect(acceptGrant({ vault: { key }, myDevice: theirs, wrappedKey: sent[0]!.p_wrapped_key }).key).toBe(key);
    expect(JSON.stringify(written)).not.toContain(key);
  });
});

describe("shareRepo", () => {
  const vaultFor = (extra: Record<string, unknown> = {}) => ({
    id: "github:owner/name",
    label: "owner/name",
    key: sodium.newVaultKey(),
    keyVersion: 1,
    secrets: [
      { name: "A", environment: "development", ciphertext: "c", nonce: "n", keyVersion: 1 },
      { name: "B", environment: "development", hint: "blank" },
    ],
    ...extra,
  });
  const make = (deps: Record<string, unknown> = {}) =>
    createSharedApi({ readVault: () => Promise.reject(new Error("unused")), readServerVault: () => Promise.reject(new Error("none here")), device: { id: "device-1", publicKey: sodium.newKeypair().publicKey }, sodium, ...deps });
  const opts = (client: unknown) => ({ orgId: "org-1", orgName: "Team", repo: " Owner/Name ", accountClient: client });

  it("skips a repo this Mac has no vault for", async () => {
    const { client } = fakeSupabase();
    expect(await make().shareRepo(opts(client))).toEqual({ skipped: "none" });
    const readRepoVault = vi.fn(() => Promise.resolve(null));
    expect(await make({ readRepoVault }).shareRepo(opts(client))).toEqual({ skipped: "none" });
    expect(readRepoVault).toHaveBeenCalledWith("owner/name");
  });

  it("skips a vault that is already shared", async () => {
    const { client } = fakeSupabase();
    expect(await make({ readRepoVault: () => Promise.resolve(vaultFor({ shared: true })) }).shareRepo(opts(client))).toEqual({ skipped: "shared" });
  });

  it("skips when the team's vault exists and this Mac holds no grant on it", async () => {
    const { client, written } = fakeSupabase({ vault: { id: "vault-1", current_key_version: 1 } });
    const prompt = vi.fn(() => Promise.resolve(true));
    expect(await make({ readRepoVault: () => Promise.resolve(vaultFor()), prompt }).shareRepo(opts(client))).toEqual({ skipped: "exists" });
    expect(prompt).not.toHaveBeenCalled();
    expect(written).toHaveLength(0);
  });

  it("shares nothing when Touch ID says no", async () => {
    const { client, written } = fakeSupabase();
    const prompt = vi.fn(() => Promise.resolve(false));
    expect(await make({ readRepoVault: () => Promise.resolve(vaultFor()), prompt }).shareRepo(opts(client))).toEqual({ denied: true });
    expect(prompt).toHaveBeenCalledWith("share 1 secret in owner/name with Team");
    expect(written).toHaveLength(0);
  });

  it("shares the vault, pulls it, and seals it to the Macs the team trusts", async () => {
    const theirs = sodium.newKeypair();
    const { client, written } = withRpc({ share_vault: ok("vault-9"), trusted_vault_gaps: ok([{ vault_id: "vault-9", device_id: "d2", public_key: theirs.publicKey, key_version: 1 }]), grant_trusted_vault_device: ok(null) });
    const vault = vaultFor({ secrets: [{ name: "A", environment: "development", ciphertext: "c", nonce: "n" }, { name: "B", environment: "development", ciphertext: "d", nonce: "n" }] });
    const prompt = vi.fn(() => Promise.resolve(true));
    const sync = { markShared: vi.fn(), pull: vi.fn(() => Promise.reject(new Error("offline"))) };
    const api = make({ readRepoVault: () => Promise.resolve(vault), readServerVault: () => Promise.resolve({ key: vault.key, keyVersion: 1, label: "owner/name" }), prompt, sync });

    const result = await api.shareRepo({ orgId: "org-1", repo: "owner/name", accountClient: client });
    expect(result).toMatchObject({ vaultId: "vault-9", repo: "owner/name", orgId: "org-1", secrets: 2, sealed: 1 });
    expect(prompt).toHaveBeenCalledWith("share 2 secrets in owner/name with your team");
    expect(calls(written, "share_vault")[0]).toMatchObject({ p_org_id: "org-1", p_repo: "owner/name", p_label: "owner/name", p_device_id: "device-1" });
    expect(sync.markShared).toHaveBeenCalledWith("github:owner/name", { orgId: "org-1", vaultId: "vault-9", repo: "owner/name", keyVersion: 1 });
    expect(sync.pull).toHaveBeenCalledWith("github:owner/name");
    expect(JSON.stringify(written)).not.toContain(vault.key);
  });

  it("shares a vault whose half-finished share this Mac holds the grant for, and answers sealed 0 when sealing throws", async () => {
    const { client } = withRpc({ share_vault: ok("vault-1"), trusted_vault_gaps: () => Promise.reject(new Error("offline")) }, { vault: { id: "vault-1", current_key_version: 1 } });
    (client.supabase.from("vault_grants") as { select: () => unknown }).select = () => ({ eq() { return this; }, limit: () => Promise.resolve({ data: [{ id: "g" }], error: null }) });
    const result = await make({ readRepoVault: () => Promise.resolve(vaultFor()) }).shareRepo(opts(client));
    expect(result).toMatchObject({ vaultId: "vault-1", secrets: 1, sealed: 0 });
  });
});

describe("grantPending", () => {
  it("seals the team's other vaults to the Mac once it's approved, and still answers the grant if that fails", async () => {
    const theirs = sodium.newKeypair();
    const key = sodium.newVaultKey();
    const pending = { id: "p", vault_id: "vault-1", status: "accepted", matched_device_id: "device-2", target_public_key: theirs.publicKey, target_fingerprint: fingerprint(theirs.publicKey) };
    const make = (gaps: Rpc) => {
      const fake = withRpc({ grant_vault_device: ok("device-2"), trusted_vault_gaps: gaps, grant_trusted_vault_device: ok(null) }, { pending });
      const api = createSharedApi({ readVault: () => Promise.reject(new Error("unused")), readServerVault: () => Promise.resolve({ label: "owner/name", key, keyVersion: 1 }), device: { id: "device-1", publicKey: sodium.newKeypair().publicKey }, sodium });
      return { ...fake, api };
    };

    const sealing = make(ok([{ vault_id: "vault-2", device_id: "device-2", public_key: theirs.publicKey, key_version: 1 }]));
    expect(await sealing.api.grantPending({ pendingId: "p", accountClient: sealing.client })).toEqual({ deviceId: "device-2", keyVersion: 1 });
    expect(sealing.written.map((w) => w.op)).toEqual(["grant_vault_device", "trusted_vault_gaps", "grant_trusted_vault_device"]);

    const failing = make(() => Promise.reject(new Error("offline")));
    expect(await failing.api.grantPending({ pendingId: "p", accountClient: failing.client })).toEqual({ deviceId: "device-2", keyVersion: 1 });
  });

  it("throws when the grant isn't waiting any more", async () => {
    const { client } = fakeSupabase();
    const api = createSharedApi({ readVault: () => Promise.reject(new Error("unused")), device: { id: "d", publicKey: "k" }, sodium });
    await expect(api.grantPending({ pendingId: "gone", accountClient: client })).rejects.toThrow(/isn't waiting/);
  });
});
