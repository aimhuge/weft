// The reads behind a shared vault's rotate (lib/team-vault-rotate.ts): which plans belong to this
// workspace, which of a member's machines could open its vaults, and the revocation that cuts those
// machines off.
//
// The writer (applyRotate) has its own file, lib/team-vault-rotate.test.ts. The fake Supabase client
// is in lib/team-vault-rotate.harness.ts.
import { describe, expect, it } from "vitest";
import { memberDevicesInOrg, plansInOrg, revokeMemberDevices } from "./team-vault-rotate";
import { makeFake, ORG_ID } from "./team-vault-rotate.harness";

// ─── plansInOrg ───────────────────────────────────────────────────────────

describe("plansInOrg", () => {
  it("keeps only the plans that belong to the workspace", async () => {
    const fake = makeFake({
      vaults: [
        { id: "vault-1", org_id: ORG_ID },
        { id: "vault-2", org_id: "org-other" },
      ],
    });
    const kept = await plansInOrg(fake.client as never, ORG_ID, [
      { vaultId: "vault-1" },
      { vaultId: "vault-2" },
    ] as never);
    expect(kept.map((p) => p.vaultId)).toEqual(["vault-1"]);
  });

  it("keeps nothing when the vault isn't there", async () => {
    const fake = makeFake({ vaults: [] });
    expect(await plansInOrg(fake.client as never, ORG_ID, [{ vaultId: "vault-1" }] as never)).toEqual([]);
  });
});

// ─── memberDevicesInOrg ───────────────────────────────────────────────────

describe("memberDevicesInOrg", () => {
  it("lists the member's machines and the vaults they could open", async () => {
    const fake = makeFake({
      devices: [{ id: "device-mate", user_id: "u2" }],
      vaults: [{ id: "vault-1", org_id: ORG_ID }],
      vault_grants: [{ device_id: "device-mate", vault_id: "vault-1" }],
    });
    expect(await memberDevicesInOrg(fake.client as never, ORG_ID, "u2")).toEqual([{ id: "device-mate", vaultIds: ["vault-1"] }]);
  });

  it("has nothing to say about a member with no machines", async () => {
    const fake = makeFake({ devices: [] });
    expect(await memberDevicesInOrg(fake.client as never, ORG_ID, "u2")).toEqual([]);
  });

  it("has nothing to say when the workspace has no vaults", async () => {
    const fake = makeFake({ devices: [{ id: "device-mate", user_id: "u2" }], vaults: [] });
    expect(await memberDevicesInOrg(fake.client as never, ORG_ID, "u2")).toEqual([]);
  });
});

// ─── revokeMemberDevices ─────────────────────────────────────────────────

describe("revokeMemberDevices", () => {
  it("revokes the member's machines and says which", async () => {
    const fake = makeFake({
      devices: [{ id: "device-mate", user_id: "u2" }],
      vaults: [{ id: "vault-1", org_id: ORG_ID }],
      vault_grants: [{ device_id: "device-mate", vault_id: "vault-1" }],
    });
    expect(await revokeMemberDevices(fake.client as never, ORG_ID, "u2")).toEqual(["device-mate"]);
    expect(fake.writes.devices?.[0]?.revoked_at).toEqual(expect.any(String));
  });

  it("does nothing when the member has no machines in the workspace's vaults", async () => {
    const fake = makeFake({ devices: [], vaults: [{ id: "vault-1", org_id: ORG_ID }] });
    expect(await revokeMemberDevices(fake.client as never, ORG_ID, "u2")).toEqual([]);
    expect(fake.writes.devices).toBeUndefined();
  });

  it("throws when the machines could not be revoked", async () => {
    const fake = makeFake({
      devices: [{ id: "device-mate", user_id: "u2" }],
      vaults: [{ id: "vault-1", org_id: ORG_ID }],
      vault_grants: [{ device_id: "device-mate", vault_id: "vault-1" }],
    });
    fake.failOn("devices", "update", "boom");
    await expect(revokeMemberDevices(fake.client as never, ORG_ID, "u2")).rejects.toThrow("Those devices could not be revoked: boom");
  });
});
