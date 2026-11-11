import { describe, expect, it } from "vitest";
import { listOrgs } from "./vault-shared-meta.cjs";

// Each table's rows, and the Macs the rpc answers with.
function fake(tables: Record<string, unknown[]>, waiting: unknown[] = []) {
  const answer = (table: string) => {
    const result = { data: tables[table] ?? [], error: null };
    const builder = { eq: () => builder, then: (done: (r: typeof result) => unknown) => Promise.resolve(result).then(done) };
    return builder;
  };
  return { signedIn: () => true, getClaims: () => ({ sub: "me" }), supabase: { from: (t: string) => ({ select: () => answer(t) }), rpc: () => Promise.resolve({ data: waiting, error: null }) } };
}

describe("listOrgs", () => {
  it("marks the workspaces this user can share a vault with", async () => {
    const client = fake({ orgs: [{ id: "o1", slug: "t", name: "T" }, { id: "o2", slug: "u", name: "U" }], org_memberships: [{ org_id: "o1", user_id: "me", role: "owner" }, { org_id: "o1", user_id: "sam", role: "member" }, { org_id: "o2", user_id: "me", role: "member" }] });
    expect(await listOrgs({ accountClient: client })).toEqual([
      { id: "o1", slug: "t", name: "T", members: 2, admin: true },
      { id: "o2", slug: "u", name: "U", members: 1, admin: false },
    ]);
  });
});
