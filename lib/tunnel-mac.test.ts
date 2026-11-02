// The Mac's tunnel host on its own: the row it reuses or makes after Touch ID, and the errors Supabase gives it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  existing: null as { id: string } | null,
  readError: null as { message: string } | null,
  insertError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  inserts: [] as unknown[],
  approved: true,
}));

vi.mock("./webhooks", () => ({ listWebhooks: () => [] }));
vi.mock("./browser-shell", () => ({ shell: () => Promise.resolve({ approved: m.approved }) }));
vi.mock("./account", () => ({
  accountClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: m.existing, error: m.readError }) }) }),
      insert: (row: unknown) => {
        m.inserts.push(row);
        return Promise.resolve({ error: m.insertError });
      },
      update: () => ({ eq: () => Promise.resolve({ error: m.updateError }) }),
    }),
  }),
}));

const { macTunnels } = await import("./tunnel-mac");
const record = { id: "t1", folder: "/p", name: "localhost:3000", target: "http://localhost:3000/" };

beforeEach(() => Object.assign(m, { existing: null, readError: null, insertError: null, updateError: null, inserts: [], approved: true }));

describe("macTunnels", () => {
  it("needs a sign-in", async () => {
    await expect(macTunnels.ready()).rejects.toThrow(/Sign in/);
  });

  it("reuses a row that's there, and makes one that isn't", async () => {
    m.existing = { id: "t1" };
    await expect(macTunnels.approve(record, 1, undefined)).resolves.toEqual({});
    expect(m.inserts).toEqual([]);
    m.existing = null;
    await macTunnels.approve(record, 1, undefined);
    expect(m.inserts).toEqual([{ id: "t1", name: "localhost:3000" }]);
  });

  it("says what Supabase said", async () => {
    m.readError = { message: "read" };
    await expect(macTunnels.approve(record, 1, undefined)).rejects.toThrow("read");
    m.readError = null;
    m.insertError = { message: "insert" };
    await expect(macTunnels.approve(record, 1, undefined)).rejects.toThrow("insert");
    m.updateError = { message: "update" };
    await expect(macTunnels.unpublish("t1")).rejects.toThrow("update");
  });

  it("opens nothing without Touch ID", async () => {
    m.approved = false;
    await expect(macTunnels.approve(record, 1, undefined)).rejects.toThrow(/Touch ID/);
    expect(m.inserts).toEqual([]);
  });
});
