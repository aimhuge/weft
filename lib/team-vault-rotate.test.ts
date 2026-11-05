// The writer behind a shared vault's rotate (lib/team-vault-rotate.ts's applyRotate): the plan
// Electron main made — sealed boxes, ciphertext, names — lands as the new grants, the key version
// bump, the re-encrypted rows, the device's revocation and the event row.
//
// The fake Supabase client lives in lib/team-vault-rotate.harness.ts. The writes have to be
// *observable* (which rows went in, in what order) because the order is the security property: the
// grants go in before the version bump, the revocation comes after the re-encrypted rows, and the
// removed device never gets a grant.
import { describe, expect, it } from "vitest";
import { applyRotate, ROTATED_ACTION } from "./team-vault-rotate";
import { ACTOR, makeFake, ORG_ID, plan, VAULT_ID, vaultSeed } from "./team-vault-rotate.harness";

// ─── applyRotate ──────────────────────────────────────────────────────────

describe("applyRotate", () => {
  it("grants the new key to the staying devices and bumps the version", async () => {
    const fake = makeFake(vaultSeed());
    const result = await applyRotate(fake.client as never, plan(), ACTOR);
    expect(result).toEqual({ ok: true, keyVersion: 2, namesToRotate: ["API_KEY"] });
    expect(fake.writes.vault_grants).toEqual([
      { vault_id: VAULT_ID, device_id: "device-admin", key_version: 2, wrapped_key: "sealed-admin", granted_by: "u1" },
      { vault_id: VAULT_ID, device_id: "device-mate", key_version: 2, wrapped_key: "sealed-mate", granted_by: "u1" },
    ]);
    expect(fake.writes.vaults).toEqual([{ id: VAULT_ID, current_key_version: 2, org_id: ORG_ID }]);
  });

  it("never grants the new key to the removed device", async () => {
    const fake = makeFake(vaultSeed());
    const result = await applyRotate(
      fake.client as never,
      plan({ grants: [{ deviceId: "device-admin", wrappedKey: "sealed" }, { deviceId: "device-gone", wrappedKey: "sealed-bad" }] }),
      ACTOR,
    );
    expect(result).toEqual({ ok: false, error: "The removed device can't be granted the new key." });
    expect(fake.writes.vault_grants).toBeUndefined();
  });

  it("refuses a plan whose key version doesn't follow the vault's", async () => {
    const fake = makeFake(vaultSeed());
    expect(await applyRotate(fake.client as never, plan({ keyVersion: 5 }), ACTOR)).toEqual({
      ok: false,
      error: "That key version doesn't follow the vault's.",
    });
    expect(fake.writes.vault_grants).toBeUndefined();
  });

  it("refuses a plan for a vault that isn't there", async () => {
    const fake = makeFake({ vaults: [] });
    expect(await applyRotate(fake.client as never, plan(), ACTOR)).toEqual({ ok: false, error: "That vault does not exist." });
  });

  it("refuses a plan the vault has already left behind", async () => {
    const fake = makeFake({ vaults: [{ id: VAULT_ID, current_key_version: 3, org_id: ORG_ID }] });
    expect(await applyRotate(fake.client as never, plan(), ACTOR)).toEqual({
      ok: false,
      error: "That vault is already on key version 3.",
    });
    expect(fake.writes.vault_grants).toBeUndefined();
  });

  it("re-encrypts the values at the new key version", async () => {
    const fake = makeFake(vaultSeed());
    await applyRotate(fake.client as never, plan(), ACTOR);
    expect(fake.writes.vault_secrets).toEqual([
      {
        id: "s1",
        vault_id: VAULT_ID,
        name: "API_KEY",
        environment: "development",
        row_version: 4,
        ciphertext: "ct-new",
        nonce: "n-new",
        key_version: 2,
        is_blank: false,
        updated_by: "u1",
      },
    ]);
  });

  it("keeps a blank's row blank and moves it to the new version", async () => {
    const fake = makeFake(vaultSeed({
      vault_secrets: [
        { id: "s1", vault_id: VAULT_ID, name: "API_KEY", environment: "development", row_version: 4 },
        { id: "s2", vault_id: VAULT_ID, name: "OPENAI_API_KEY", environment: "development", row_version: 0 },
      ],
    }));
    await applyRotate(
      fake.client as never,
      plan({ secrets: [{ name: "OPENAI_API_KEY", environment: "development", ciphertext: "", nonce: "", rowVersion: 0, blank: true }] }),
      ACTOR,
    );
    expect(fake.writes.vault_secrets).toEqual([
      {
        id: "s2",
        vault_id: VAULT_ID,
        name: "OPENAI_API_KEY",
        environment: "development",
        row_version: 0,
        ciphertext: null,
        nonce: null,
        key_version: 2,
        is_blank: true,
        updated_by: "u1",
      },
    ]);
  });

  it("revokes the removed device", async () => {
    const fake = makeFake(vaultSeed());
    await applyRotate(fake.client as never, plan(), ACTOR);
    const revoked = fake.writes.devices ?? [];
    expect(revoked).toHaveLength(1);
    expect(revoked[0]?.revoked_at).toEqual(expect.any(String));
    expect(revoked[0]?.id).toBe("device-gone");
  });

  it("records the rotate in the event log, with names and no values", async () => {
    const fake = makeFake(vaultSeed());
    await applyRotate(fake.client as never, plan(), ACTOR);
    const events = fake.writes.vault_events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe(ROTATED_ACTION);
    expect(events[0]?.actor_user_id).toBe("u1");
    expect(events[0]?.actor_email).toBe("jane@example.com");
    expect(events[0]?.metadata).toEqual({
      key_version: 2,
      previous_key_version: 1,
      removed_device_id: "device-gone",
      names_to_rotate: ["API_KEY"],
    });
    // Nothing but names: no ciphertext, no nonce, no key.
    expect(JSON.stringify(events[0])).not.toContain("ct-new");
    expect(JSON.stringify(events[0])).not.toContain("sealed-admin");
  });

  it("writes the grants before the version bump, and the revocation after the rows", async () => {
    const fake = makeFake(vaultSeed());
    await applyRotate(fake.client as never, plan(), ACTOR);
    const order = fake.calls.map((c) => `${c.table}.${c.op}`);
    expect(order.indexOf("vault_grants.upsert")).toBeLessThan(order.indexOf("vaults.update"));
    expect(order.indexOf("vault_secrets.update")).toBeLessThan(order.indexOf("devices.update"));
    expect(order.indexOf("devices.update")).toBeLessThan(order.indexOf("vault_events.insert"));
  });

  it("says so when the grants could not be written", async () => {
    const fake = makeFake(vaultSeed());
    fake.failOn("vault_grants", "upsert", "boom");
    expect(await applyRotate(fake.client as never, plan(), ACTOR)).toEqual({
      ok: false,
      error: "The new key could not be granted: boom",
    });
  });

  it("says so when the version could not be bumped", async () => {
    const fake = makeFake(vaultSeed());
    fake.failOn("vaults", "update", "boom");
    expect(await applyRotate(fake.client as never, plan(), ACTOR)).toEqual({
      ok: false,
      error: "The vault's key version could not be bumped: boom",
    });
  });

  it("says so when a value could not be re-encrypted", async () => {
    const fake = makeFake(vaultSeed());
    fake.failOn("vault_secrets", "update", "boom");
    expect(await applyRotate(fake.client as never, plan(), ACTOR)).toEqual({
      ok: false,
      error: "API_KEY could not be re-encrypted: boom",
    });
  });

  it("says so when the device could not be revoked", async () => {
    const fake = makeFake(vaultSeed());
    fake.failOn("devices", "update", "boom");
    expect(await applyRotate(fake.client as never, plan(), ACTOR)).toEqual({
      ok: false,
      error: "That device could not be revoked: boom",
    });
  });

  it("says so when the event could not be recorded", async () => {
    const fake = makeFake(vaultSeed());
    fake.failOn("vault_events", "insert", "boom");
    expect(await applyRotate(fake.client as never, plan(), ACTOR)).toEqual({
      ok: false,
      error: "The rotate could not be recorded: boom",
    });
  });
});

// ─── plansInOrg ───────────────────────────────────────────────────────────
