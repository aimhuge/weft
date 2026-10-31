import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));

const { listPushDevices, removePushDevice } = await import("./push-devices");

function fakeClient({ user = true, rows = [] as unknown[], error = null as { message: string } | null } = {}) {
  const calls: { op: string; args: unknown[] }[] = [];
  const query = {
    select: (...args: unknown[]) => (calls.push({ op: "select", args }), query),
    order: (...args: unknown[]) => (calls.push({ op: "order", args }), Promise.resolve({ data: rows, error })),
    delete: () => (calls.push({ op: "delete", args: [] }), query),
    eq: (...args: unknown[]) => (calls.push({ op: "eq", args }), Promise.resolve({ error })),
  };
  const client = {
    auth: { getSession: () => Promise.resolve({ data: { session: user ? { user: { id: "u1" } } : null } }) },
    from: (table: string) => (calls.push({ op: "from", args: [table] }), query),
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("listPushDevices", () => {
  it("is empty and signed out with no session", async () => {
    const { client, calls } = fakeClient({ user: false });
    expect(await listPushDevices(client)).toEqual({ signedIn: false, devices: [] });
    expect(calls).toEqual([]);
  });

  it("maps rows, newest seen first", async () => {
    const rows = [{ id: "d1", platform: "ios", device_name: "Alex's iPhone", created_at: "2026-10-01", last_seen_at: "2026-10-29" }];
    const { client, calls } = fakeClient({ rows });
    expect(await listPushDevices(client)).toEqual({
      signedIn: true,
      devices: [{ id: "d1", platform: "ios", deviceName: "Alex's iPhone", createdAt: "2026-10-01", lastSeenAt: "2026-10-29" }],
    });
    expect(calls[0]).toEqual({ op: "from", args: ["push_devices"] });
    expect(calls.at(-1)).toEqual({ op: "order", args: ["last_seen_at", { ascending: false }] });
  });

  it("treats null data as no phones", async () => {
    const { client } = fakeClient({ rows: null as unknown as unknown[] });
    expect(await listPushDevices(client)).toEqual({ signedIn: true, devices: [] });
  });

  it("throws the database's error", async () => {
    const { client } = fakeClient({ error: { message: "boom" } });
    await expect(listPushDevices(client)).rejects.toThrow("Couldn't read your phones: boom");
  });

  it("uses the account client by default", async () => {
    await expect(listPushDevices()).rejects.toThrow("no default client in tests");
  });
});

describe("removePushDevice", () => {
  it("deletes the row by id", async () => {
    const { client, calls } = fakeClient();
    await removePushDevice("d1", client);
    expect(calls).toEqual([
      { op: "from", args: ["push_devices"] },
      { op: "delete", args: [] },
      { op: "eq", args: ["id", "d1"] },
    ]);
  });

  it("refuses when signed out", async () => {
    const { client } = fakeClient({ user: false });
    await expect(removePushDevice("d1", client)).rejects.toThrow("Sign in to Weft");
  });

  it("throws the database's error", async () => {
    const { client } = fakeClient({ error: { message: "nope" } });
    await expect(removePushDevice("d1", client)).rejects.toThrow("Couldn't remove that phone: nope");
  });

  it("uses the account client by default", async () => {
    await expect(removePushDevice("d1")).rejects.toThrow("no default client in tests");
  });
});
