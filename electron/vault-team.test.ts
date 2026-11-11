import { describe, expect, it, vi } from "vitest";
import { fingerprint } from "./device-fingerprint.cjs";
import { joinHintFor, teamVaults } from "./vault-team.cjs";

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

  it("answers nothing signed out, says so, and never loads the device key", async () => {
    const key = vi.fn(() => KEY);
    const out = await teamVaults({ accountClient: { ...fake({}), signedIn: () => false }, publicKey: key });
    expect(out.joins.size).toBe(0);
    expect(out.reason).toBe("signed-out");
    expect(key).not.toHaveBeenCalled();
  });

  it("says the lookup failed when the server throws, errors, or there's no device key, so the drawer still opens", async () => {
    const broken = { signedIn: () => true, supabase: { from: () => { throw new Error("offline"); } } };
    expect(await teamVaults({ accountClient: broken, publicKey: KEY })).toEqual({ joins: new Map(), requests: new Map(), reason: "error" });
    const denied = fake({});
    const from = denied.supabase.from;
    denied.supabase.from = (t: string) => (t === "vaults" ? { select: () => Promise.resolve({ data: null, error: { message: "rls" } }) } : from(t)) as ReturnType<typeof from>;
    expect((await teamVaults({ accountClient: denied, publicKey: KEY })).reason).toBe("error");
    expect((await teamVaults({ accountClient: fake({}), publicKey: () => "" })).reason).toBe("error");
  });

  it("gives no reason when the lookup ran, so a missing repo means nothing is shared", async () => {
    const out = await teamVaults({ accountClient: fake({}), publicKey: () => KEY });
    expect(out.reason).toBeUndefined();
    expect(out.joins.size).toBe(0);
  });

  it("knows a shell with no account client checked nothing", async () => {
    expect((await teamVaults({ publicKey: KEY })).reason).toBe("no-account");
  });
});

describe("joinHintFor", () => {
  const blank = [{ missing: true }];
  const local = { id: "github:a/b", secrets: blank };

  it("says why a repo's local vault has no Ask to join", () => {
    expect(joinHintFor({ ...local, reason: "signed-out" })).toBe("signed-out");
    expect(joinHintFor({ ...local, reason: "error" })).toBe("error");
    expect(joinHintFor(local)).toBe("none");
  });

  it("puts a removed or unregistered Mac first, shared vaults included, but not on a folder with no repo", () => {
    expect(joinHintFor({ ...local, secrets: [{}], device: "revoked" })).toBe("revoked");
    expect(joinHintFor({ ...local, shared: {}, device: "unregistered" })).toBe("unregistered");
    expect(joinHintFor({ id: "local:x", secrets: blank, device: "revoked" })).toBeUndefined();
    expect(joinHintFor({ ...local, secrets: [{}], device: "registered" })).toBeUndefined();
  });

  it("doesn't tell the Mac that has the secrets that nothing is shared", () => {
    expect(joinHintFor({ ...local, secrets: [{}] })).toBeUndefined();
    expect(joinHintFor({ ...local, secrets: [{}], reason: "signed-out" })).toBe("signed-out");
  });

  it("says nothing for a shared vault, one with a join to offer, or a folder with no repo", () => {
    expect(joinHintFor({ ...local, shared: {} })).toBeUndefined();
    expect(joinHintFor({ ...local, join: {} })).toBeUndefined();
    expect(joinHintFor({ id: "folder:/x", secrets: [], reason: "signed-out" })).toBeUndefined();
    expect(joinHintFor({ ...local, reason: "no-account" })).toBeUndefined();
  });
});
