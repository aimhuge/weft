import { describe, expect, it } from "vitest";
import { fingerprint } from "./device-fingerprint.cjs";
import { listOrgs } from "./vault-shared-meta.cjs";
import { teamVaults } from "./vault-team.cjs";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER = Buffer.alloc(32, 9).toString("base64");

// Each table's rows, and the Macs the rpc answers with.
function fake(tables: Record<string, unknown[]>, waiting: unknown[] = []) {
  const answer = (table: string) => {
    const result = { data: tables[table] ?? [], error: null };
    const builder = { eq: () => builder, then: (done: (r: typeof result) => unknown) => Promise.resolve(result).then(done) };
    return builder;
  };
  return { signedIn: () => true, getClaims: () => ({ sub: "me" }), supabase: { from: (t: string) => ({ select: () => answer(t) }), rpc: () => Promise.resolve({ data: waiting, error: null }) } };
}

describe("teamVaults", () => {
  const vaults = [{ id: "v1", org_id: "o1", repo: "a/b" }];

  it("says this Mac isn't in a vault its workspace shares", async () => {
    const { joins } = await teamVaults({ accountClient: fake({ vaults }), publicKey: KEY });
    expect(joins.get("a/b")).toEqual({ vaultId: "v1", orgId: "o1", repo: "a/b", state: "none", fingerprint: fingerprint(KEY) });
  });

  it("knows this Mac's own request, and not a teammate's", async () => {
    const mine = await teamVaults({ accountClient: fake({ vaults, pending_device_grants: [{ vault_id: "v1", target_fingerprint: fingerprint(KEY) }] }), publicKey: KEY });
    expect(mine.joins.get("a/b")?.state).toBe("asked");
    const theirs = await teamVaults({ accountClient: fake({ vaults, pending_device_grants: [{ vault_id: "v1", target_fingerprint: fingerprint(OTHER) }] }), publicKey: KEY });
    expect(theirs.joins.get("a/b")?.state).toBe("none");
  });

  it("knows an approval by this Mac's own key", async () => {
    const { joins } = await teamVaults({ accountClient: fake({ vaults, vault_grants: [{ vault_id: "v1", device: { public_key: KEY } }] }), publicKey: KEY });
    expect(joins.get("a/b")?.state).toBe("granted");
  });

  it("groups the Macs waiting by vault", async () => {
    const { requests } = await teamVaults({ accountClient: fake({ vaults }, [{ id: "p", vault_id: "v1", person: "Sam", device_name: "Mac", fingerprint: "f" }]), publicKey: KEY });
    expect(requests.get("v1")).toEqual([{ id: "p", person: "Sam", deviceName: "Mac", fingerprint: "f" }]);
  });

  it("answers nothing signed out or when the server fails, so the drawer still opens", async () => {
    expect((await teamVaults({ accountClient: { ...fake({}), signedIn: () => false }, publicKey: KEY })).joins.size).toBe(0);
    const broken = { signedIn: () => true, supabase: { from: () => { throw new Error("offline"); } } };
    expect((await teamVaults({ accountClient: broken, publicKey: KEY })).joins.size).toBe(0);
  });
});

describe("listOrgs", () => {
  it("marks the workspaces this user can share a vault with", async () => {
    const client = fake({ orgs: [{ id: "o1", slug: "t", name: "T" }, { id: "o2", slug: "u", name: "U" }], org_memberships: [{ org_id: "o1", user_id: "me", role: "owner" }, { org_id: "o1", user_id: "sam", role: "member" }, { org_id: "o2", user_id: "me", role: "member" }] });
    expect(await listOrgs({ accountClient: client })).toEqual([
      { id: "o1", slug: "t", name: "T", members: 2, admin: true },
      { id: "o2", slug: "u", name: "U", members: 1, admin: false },
    ]);
  });
});
