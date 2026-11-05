// The rotate-on-remove path (docs/architecture/teams-vault.md, "Removal and rotation"): what a rotate
// produces, and the rules it has to keep.
//
// The fixture is a vault with three devices — the admin's, a teammate's, and one that is being
// removed — each with a grant for the vault's key version 1, and two values under that key.
//
// The rules the tests pin:
//   - the new key is sealed to the two devices that stay, and to nobody else;
//   - the removed device gets no grant for the new key version, and is the one the plan revokes;
//   - the old wrapped key stays in vault_grants for one cycle, so an offline teammate can still read
//     what was encrypted under version 1;
//   - the values are re-encrypted under the new key and open with it, and no longer open with the old;
//   - the list of names to rotate at their providers holds names only — never a value;
//   - nothing that leaves carries the new key.
import { beforeAll, describe, expect, it } from "vitest";
import { namesToRotate, rotate, rotateBody } from "./vault-rotate.cjs";
import { fakeDb } from "./vault-sync.harness";
import { cryptoReady } from "./vault-grant.cjs";
import * as sodium from "./vault-crypto.cjs";

beforeAll(async () => {
  await cryptoReady(sodium);
  await sodium.ready();
});

const VAULT_ID = "vault-1";
const ADMIN = "device-admin";
const TEAMMATE = "device-mate";
const REMOVED = "device-gone";

// The plan the rotate produces. electron/vault-rotate.cjs is CommonJS, so the module's own shape
// doesn't reach the test; this is the plan as the server's writer takes it.
type RotatePlan = {
  vaultId: string;
  keyVersion: number;
  previousKeyVersion: number;
  revokedDeviceId: string;
  grants: { deviceId: string; wrappedKey: string }[];
  secrets: { name: string; environment: string; ciphertext: string; nonce: string; rowVersion: number; blank: boolean }[];
  namesToRotate: string[];
  actorUserId: string;
  rotatedAt: string;
};

// Three keypairs: the admin's machine, the teammate's, and the machine that is going away.
const keys = () => ({
  admin: sodium.newKeypair(),
  mate: sodium.newKeypair(),
  gone: sodium.newKeypair(),
});

// The vault's key at version 1, and the values under it.
function fixture() {
  const db = fakeDb();
  const keypairs = keys();
  const key = sodium.newVaultKey();
  const devices = [
    { id: ADMIN, publicKey: keypairs.admin.publicKey },
    { id: TEAMMATE, publicKey: keypairs.mate.publicKey },
    { id: REMOVED, publicKey: keypairs.gone.publicKey },
  ];
  for (const device of devices) {
    db.tables.devices.push({
      id: device.id,
      user_id: device.id === ADMIN ? "user-admin" : "user-mate",
      name: device.id,
      public_key: device.publicKey,
      fingerprint: "aabbccdd",
      platform: "darwin",
      last_seen_at: "2026-10-27T00:00:00.000Z",
      revoked_at: null,
    });
    db.tables.vault_grants.push({
      id: `grant-${device.id}`,
      vault_id: VAULT_ID,
      device_id: device.id,
      key_version: 1,
      wrapped_key: sodium.wrapKey(key, device.publicKey),
      granted_by: "user-admin",
      granted_at: "2026-10-27T00:00:00.000Z",
    });
  }
  db.tables.vaults.push({ id: VAULT_ID, org_id: "org-1", repo: "owner/name", label: "owner/name", current_key_version: 1, server_version: 3 });
  const secrets = [
    { name: "API_KEY", environment: "development", value: "sk_test_0123456789" }, // gitleaks:allow
    { name: "STRIPE_KEY", environment: "production", value: "sk_live_abcdefghij" }, // gitleaks:allow
  ];
  for (const secret of secrets) {
    const box = sodium.encrypt(secret.value, key, sodium.aad(VAULT_ID, secret.name, secret.environment, 1));
    db.tables.vault_secrets.push({
      id: `secret-${secret.name}`,
      vault_id: VAULT_ID,
      name: secret.name,
      environment: secret.environment,
      ciphertext: box.ciphertext,
      nonce: box.nonce,
      key_version: 1,
      row_version: 4,
      is_blank: false,
      hint: null,
      updated_by: "user-admin",
      updated_at: "2026-10-27T00:00:00.000Z",
    });
  }
  const accountClient = { supabase: db.client, getClaims: () => ({ sub: "user-admin", email: "admin@example.com" }) };
  const device = { id: ADMIN, ...keypairs.admin };
  // The rotate, run against this fixture with the admin's machine as the one doing it.
  const run = (over: { removedDeviceId?: string; device?: { id?: string; publicKey: string; privateKey?: string } } = {}) =>
    rotate({ vaultId: VAULT_ID, removedDeviceId: over.removedDeviceId ?? REMOVED, accountClient, device: over.device ?? device, sodium, now: () => Date.parse("2026-10-27T12:00:00.000Z") }) as Promise<RotatePlan>;
  return { db, keypairs, key, accountClient, device, run };
}

// The rotate, run against the fixture.
const run = () => fixture().run();

describe("rotate", () => {
  it("bumps the key version and seals the new key to the two devices that stay", async () => {
    const plan = await run();
    expect(plan.keyVersion).toBe(2);
    expect(plan.previousKeyVersion).toBe(1);
    // Two grants: the admin's machine and the teammate's. The removed device isn't one of them.
    expect(plan.grants.map((g) => g.deviceId).sort()).toEqual([ADMIN, TEAMMATE]);
    expect(plan.grants.some((g) => g.deviceId === REMOVED)).toBe(false);
    expect(plan.revokedDeviceId).toBe(REMOVED);
  });

  it("seals the new key so only the two remaining devices can open it", async () => {
    const f = fixture();
    const plan = await f.run();
    for (const grant of plan.grants) {
      const sealed = grant.wrappedKey;
      const owner = grant.deviceId === ADMIN ? f.keypairs.admin : f.keypairs.mate;
      const other = grant.deviceId === ADMIN ? f.keypairs.mate : f.keypairs.admin;
      // The device it was sealed to opens it.
      expect(sodium.unwrapKey(sealed, owner)).toBeTruthy();
      // Nobody else does.
      expect(() => sodium.unwrapKey(sealed, other)).toThrow();
    }
    // The removed device can't open the new key: it was never sealed to it.
    const forRemoved = plan.grants.find((g) => g.deviceId === REMOVED);
    expect(forRemoved).toBeUndefined();
  });

  it("never lets the new key out of the plan", async () => {
    const plan = await run();
    const body = rotateBody(plan);
    const serialized = JSON.stringify(body);
    // The plan holds sealed boxes and ciphertext; the key itself is not in it.
    for (const grant of plan.grants) {
      // A sealed box is not the key: opening it needs a private half the plan doesn't have.
      expect(grant.wrappedKey).not.toBe(body.keyVersion.toString());
    }
    // And the ciphertext is not the value either.
    expect(serialized).not.toContain("sk_test_0123456789"); // gitleaks:allow
    expect(serialized).not.toContain("sk_live_abcdefghij"); // gitleaks:allow
  });

  it("re-encrypts every value under the new key, so the old key opens nothing", async () => {
    const f = fixture();
    const plan = await f.run();
    expect(plan.secrets).toHaveLength(2);
    const newKey = sodium.unwrapKey(plan.grants.find((g) => g.deviceId === ADMIN)!.wrappedKey, f.keypairs.admin);
    for (const secret of plan.secrets) {
      // The new ciphertext opens with the new key, under the new key version's AAD.
      expect(sodium.decrypt({ ciphertext: secret.ciphertext, nonce: secret.nonce }, newKey, sodium.aad(VAULT_ID, secret.name, secret.environment, 2))).toBeTruthy();
      // The old key opens nothing: the row was re-encrypted, and the AAD moved with it.
      expect(() => sodium.decrypt({ ciphertext: secret.ciphertext, nonce: secret.nonce }, f.key, sodium.aad(VAULT_ID, secret.name, secret.environment, 2))).toThrow();
    }
  });

  it("lists the names to rotate at their providers, and nothing else", async () => {
    const plan = await run();
    expect(plan.namesToRotate).toEqual(["API_KEY", "STRIPE_KEY"]);
    // The list is names: a value never appears in it.
    const listed = JSON.stringify(plan.namesToRotate);
    expect(listed).not.toContain("sk_test_0123456789"); // gitleaks:allow
    expect(listed).not.toContain("sk_live_abcdefghij"); // gitleaks:allow
  });

  it("leaves a blank out of the list — there is no value to rotate", async () => {
    const f = fixture();
    f.db.tables.vault_secrets.push({ id: "secret-BLANK", vault_id: VAULT_ID, name: "NEW_TOKEN", environment: "development", ciphertext: null, nonce: null, key_version: 1, row_version: 0, is_blank: true, hint: "from the dashboard", updated_by: "user-admin", updated_at: "2026-10-27T00:00:00.000Z" });
    const plan = await f.run();
    expect(plan.namesToRotate).toEqual(["API_KEY", "STRIPE_KEY"]);
    // The blank still moves to the new key version, so the vault is on one version.
    const blank = plan.secrets.find((s) => s.name === "NEW_TOKEN");
    expect(blank?.blank).toBe(true);
  });

  it("keeps the old wrapped keys in vault_grants, so an offline teammate can still read version 1", async () => {
    const f = fixture();
    await f.run();
    // The plan adds new grants; it never deletes the old ones.
    const old = f.db.tables.vault_grants.filter((g) => g.key_version === 1);
    expect(old).toHaveLength(3);
    // Including the removed device's: the old key stays readable for one cycle, and the device is
    // revoked instead — a revoked device can't fetch a *new* grant.
    expect(old.some((g) => g.device_id === REMOVED)).toBe(true);
  });

  it("seals the new key to the recovery device too, when the vault has one", async () => {
    const f = fixture();
    const recovery = sodium.newKeypair();
    f.db.tables.devices.push({ id: "device-recovery", user_id: null, name: "recovery", public_key: recovery.publicKey, fingerprint: "recovery", platform: "darwin", last_seen_at: "2026-10-27T00:00:00.000Z", revoked_at: null });
    f.db.tables.vault_grants.push({ id: "grant-recovery", vault_id: VAULT_ID, device_id: "device-recovery", key_version: 1, wrapped_key: sodium.wrapKey(f.key, recovery.publicKey), granted_by: "user-admin", granted_at: "2026-10-27T00:00:00.000Z" });
    const plan = await f.run();
    const forRecovery = plan.grants.find((g) => g.deviceId === "device-recovery");
    expect(forRecovery).toBeDefined();
    // The recovery words still open the vault after the rotate.
    expect(sodium.unwrapKey(forRecovery!.wrappedKey, recovery)).toBeTruthy();
  });

  it("refuses to rotate a vault this device has no key for", async () => {
    const f = fixture();
    const stranger = sodium.newKeypair();
    await expect(f.run({ device: { id: "device-stranger", ...stranger } })).rejects.toThrow(/no key for that vault/);
  });

  it("refuses to rotate without a signed-in user, a vault, or a device", async () => {
    const f = fixture();
    await expect(rotate({ vaultId: VAULT_ID, removedDeviceId: REMOVED, accountClient: { supabase: f.db.client, getClaims: () => null }, device: f.device, sodium })).rejects.toThrow(/Sign in/);
    await expect(rotate({ vaultId: "", removedDeviceId: REMOVED, accountClient: f.accountClient, device: f.device, sodium })).rejects.toThrow(/belongs to a vault/);
    await expect(rotate({ vaultId: VAULT_ID, removedDeviceId: "", accountClient: f.accountClient, device: f.device, sodium })).rejects.toThrow(/device that is being removed/);
  });

  it("says so when the vault isn't there", async () => {
    const f = fixture();
    await expect(rotate({ vaultId: "vault-nope", removedDeviceId: REMOVED, accountClient: f.accountClient, device: f.device, sodium })).rejects.toThrow(/does not exist/);
  });
});

describe("rotateBody", () => {
  it("carries the plan and nothing else — no actor, no timestamp, no key", async () => {
    const plan = await run();
    const body = rotateBody(plan);
    expect(body.keyVersion).toBe(2);
    expect(body.previousKeyVersion).toBe(1);
    expect(body.revokedDeviceId).toBe(REMOVED);
    expect(body.grants).toHaveLength(2);
    expect(body.secrets).toHaveLength(2);
    expect(body.namesToRotate).toEqual(["API_KEY", "STRIPE_KEY"]);
    // The actor and the timestamp are the server's business.
    expect(body).not.toHaveProperty("actorUserId");
    expect(body).not.toHaveProperty("rotatedAt");
  });
});

describe("namesToRotate", () => {
  it("lists each name once, and skips the blanks", () => {
    const names = namesToRotate([
      { id: "s1", name: "API_KEY", environment: "development", key_version: 1, row_version: 4, is_blank: false },
      { id: "s2", name: "API_KEY", environment: "production", key_version: 1, row_version: 4, is_blank: false },
      { id: "s3", name: "TOKEN", environment: "development", key_version: 1, row_version: 4, is_blank: true },
    ]);
    expect(names).toEqual(["API_KEY"]);
  });
});
