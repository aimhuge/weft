import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deviceLabel, projectVaults, withProjectVaults, type VaultRows } from "./team-project-vaults";
import type { TeamMember, TeamProject } from "./team-types";

const MEMBERS: TeamMember[] = [
  { userId: "u1", email: "alex@x.com", name: "Alex", role: "owner", joinedAt: "" },
  { userId: "u2", email: "sam@x.com", name: null, role: "member", joinedAt: "" },
];
const project = (repo: string): TeamProject => ({ repo, addedAt: "", addedBy: null, access: [] });
const dev = (id: string, name: string, user = "u1", extra = {}) => ({ id, name, user_id: user, fingerprint: `fp-${id}`, last_seen_at: "2026-11-05", revoked_at: null, ...extra });
const EMPTY: VaultRows = { vaults: [], grants: [], asks: [], local: [] };

describe("deviceLabel", () => {
  it("drops the Weft on prefix", () => {
    expect(deviceLabel("Weft on Alex's m5air")).toBe("Alex's m5air");
    expect(deviceLabel("m1mini")).toBe("m1mini");
  });
});

describe("projectVaults", () => {
  it("is not shared and on no Mac when nothing is known", () => {
    expect(projectVaults([project("a/b")], EMPTY, MEMBERS)[0]!.vault).toEqual({ shared: null, localOn: [] });
  });

  it("names the members' Macs that keep an unshared vault, any case", () => {
    const rows = { ...EMPTY, local: [{ name: "Weft on m5air", user_id: "u1", last_seen_at: null, local_vaults: ["aimhuge/weft"] }] };
    expect(projectVaults([project("AimHuge/Weft"), project("a/b")], rows, MEMBERS).map((p) => p.vault?.localOn)).toEqual([
      [{ name: "m5air", person: "Alex", lastSeen: null }],
      [],
    ]);
  });

  it("lists the Macs holding the current key, once each, without the recovery key, a revoked or an old grant", () => {
    const rows: VaultRows = {
      ...EMPTY,
      vaults: [{ id: "v1", repo: "a/b", current_key_version: 2 }],
      grants: [
        { vault_id: "v1", key_version: 2, device: dev("d1", "m5air") },
        { vault_id: "v1", key_version: 2, device: dev("d1", "m5air") },
        { vault_id: "v1", key_version: 1, device: dev("d2", "old") },
        { vault_id: "v1", key_version: 2, device: dev("d3", "gone", "u1", { revoked_at: "x" }) },
        { vault_id: "v1", key_version: 2, device: dev("d4", "recovery", null as never, { fingerprint: "recovery" }) },
        { vault_id: "v1", key_version: 2, device: null },
        { vault_id: "v2", key_version: 2, device: dev("d5", "other") },
        { vault_id: "v1", key_version: 2, device: { name: "noid", user_id: "u9", last_seen_at: null } },
      ],
    };
    const shared = projectVaults([project("a/b")], rows, MEMBERS)[0]!.vault?.shared;
    expect(shared).toMatchObject({ vaultId: "v1", keyVersion: 2, asks: [] });
    expect(shared?.devices).toEqual([
      { name: "m5air", person: "Alex", lastSeen: "2026-11-05" },
      { name: "noid", person: "A teammate", lastSeen: null },
    ]);
  });

  it("lists the asks still waiting, not one whose Mac already holds the key", () => {
    const rows: VaultRows = {
      ...EMPTY,
      vaults: [{ id: "v1", repo: "a/b", current_key_version: 1 }],
      grants: [{ vault_id: "v1", key_version: 1, device: dev("d1", "m5air") }],
      asks: [
        { id: "p1", vault_id: "v1", target_user_id: "u2", device: dev("d2", "Weft on m1mini", "u2") },
        { id: "p2", vault_id: "v1", target_user_id: "u1", device: dev("d1", "m5air") },
        { id: "p3", vault_id: "v1", target_user_id: "u2", device: null },
        { id: "p4", vault_id: "v1", target_user_id: "u2", device: dev("d6", "x", "u2", { revoked_at: "y" }) },
        { id: "p5", vault_id: "v1", target_user_id: "u2", device: { name: "nofp", user_id: "u2", last_seen_at: null } },
      ],
    };
    expect(projectVaults([project("a/b")], rows, MEMBERS)[0]!.vault?.shared?.asks).toEqual([
      { id: "p1", person: "sam@x.com", deviceName: "m1mini", fingerprint: "fp-d2" },
      { id: "p5", person: "sam@x.com", deviceName: "nofp", fingerprint: "" },
    ]);
  });
});

// A supabase-js-like builder: every filter returns itself, awaiting it answers the table's result.
function service(results: Record<string, { data?: unknown; error?: { message: string } | null }>) {
  const calls: { table: string; ops: unknown[][] }[] = [];
  return {
    calls,
    from(table: string) {
      const call = { table, ops: [] as unknown[][] };
      calls.push(call);
      const q: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "is", "overlaps", "gt"]) q[op] = (...args: unknown[]) => (call.ops.push([op, ...args]), q);
      q.then = (done: (r: unknown) => unknown) => done({ data: results[table]?.data ?? null, error: results[table]?.error ?? null });
      return q;
    },
  };
}
const ctx = (svc: unknown, role = "owner") => ({ user: { id: "u1" }, org: { id: "o1" }, role, orgs: [], service: svc }) as never;

describe("withProjectVaults", () => {
  it("leaves an empty list alone", async () => {
    const svc = service({});
    expect(await withProjectVaults(ctx(svc), [], MEMBERS)).toEqual([]);
    expect(svc.calls).toEqual([]);
  });

  it("reads the vaults, grants, asks and members' Macs, and never a wrapped key or a value", async () => {
    const svc = service({
      vaults: { data: [{ id: "v1", repo: "a/b", current_key_version: 1 }] },
      vault_grants: { data: [{ vault_id: "v1", key_version: 1, device: dev("d1", "m5air") }] },
      pending_device_grants: { data: [] },
      devices: { data: [{ name: "m1mini", user_id: "u1", last_seen_at: null, local_vaults: ["c/d"] }] },
    });
    const [ab, cd] = await withProjectVaults(ctx(svc), [project("A/B"), project("c/d")], MEMBERS);
    expect(ab!.vault?.shared?.devices.map((d) => d.name)).toEqual(["m5air"]);
    expect(cd!.vault).toEqual({ shared: null, localOn: [{ name: "m1mini", person: "Alex", lastSeen: null }] });
    expect(svc.calls.map((c) => c.table).sort()).toEqual(["devices", "pending_device_grants", "vault_grants", "vaults"]);
    expect(JSON.stringify(svc.calls)).not.toMatch(/wrapped|ciphertext/);
    expect(svc.calls.find((c) => c.table === "vaults")?.ops).toContainEqual(["in", "repo", ["a/b", "c/d"]]);
  });

  it("skips the asks for a member, and the grants when nothing is shared", async () => {
    const shared = service({ vaults: { data: [{ id: "v1", repo: "a/b", current_key_version: 1 }] } });
    await withProjectVaults(ctx(shared, "member"), [project("a/b")], MEMBERS);
    expect(shared.calls.map((c) => c.table)).not.toContain("pending_device_grants");
    const none = service({});
    const [p] = await withProjectVaults(ctx(none), [project("a/b")], MEMBERS);
    expect(none.calls.map((c) => c.table).sort()).toEqual(["devices", "vaults"]);
    expect(p!.vault).toEqual({ shared: null, localOn: [] });
  });

  it("gives the projects back as they came when the vaults read fails", async () => {
    const svc = service({ vaults: { error: { message: "rls" } } });
    expect(await withProjectVaults(ctx(svc), [project("a/b")], MEMBERS)).toEqual([project("a/b")]);
  });
});
