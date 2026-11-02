import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("./account", () => ({ accountClient: () => ({ marker: "default" }) }));
vi.mock("./device-id", () => ({ deviceId: () => "here-id" }));

const { deviceView, listDevices, revokeDevice, sortDevices } = await import("./device-registry");

const row = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  kind: "mac",
  name: "MacBook",
  platform: "darwin",
  owner_user: "u1",
  org_id: "o1",
  box_key: "box",
  sign_key: null,
  passkey_key: null,
  fingerprint: "fp",
  host: "here-id",
  status: "online" as const,
  last_seen_at: "2026-11-02T00:00:00Z",
  revoked_at: null,
  build: null,
  ...over,
});

function fakeClient(opts: { user?: string | null; data?: unknown; error?: { message: string } | null; notes?: unknown; rpc?: { data: unknown; error: { message: string } | null } } = {}) {
  const calls: unknown[][] = [];
  const query = {
    select: (...a: unknown[]) => (calls.push(["select", ...a]), query),
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), Promise.resolve({ data: "data" in opts ? opts.data : [], error: opts.error ?? null })),
    in: (...a: unknown[]) => (calls.push(["in", ...a]), Promise.resolve({ data: opts.notes ?? null, error: opts.notes ? null : { message: "denied" } })),
  };
  const client = {
    auth: { getSession: () => Promise.resolve({ data: { session: opts.user === null ? null : { user: { id: opts.user ?? "u1" } } } }) },
    from: (t: string) => (calls.push(["from", t]), query),
    rpc: (fn: string, args: unknown) => (calls.push(["rpc", fn, args]), Promise.resolve(opts.rpc ?? { data: "worker", error: null })),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("deviceView", () => {
  it("shows what a device holds, never the keys", () => {
    const v = deviceView(row(), "here-id");
    expect(v).toMatchObject({ kind: "mac", hasBoxKey: true, hasSignKey: false, hasPasskey: false, approves: false, here: true });
    expect(JSON.stringify(v)).not.toContain('"box"');
  });

  it("carries the build a device reports", () => {
    expect(deviceView(row({ build: "0.7.0+abc1234" }), "x").build).toBe("0.7.0+abc1234");
    expect(deviceView(row(), "x").build).toBeNull();
    expect(deviceView({ ...row(), build: undefined } as never, "x").build).toBeNull();
  });

  it("a phone with a sign key approves until it's revoked", () => {
    expect(deviceView(row({ kind: "phone", sign_key: "s", host: null }), "x").approves).toBe(true);
    expect(deviceView(row({ kind: "phone", sign_key: "s", revoked_at: "2026-11-02T00:00:00Z" }), "x").approves).toBe(false);
    expect(deviceView(row({ kind: "phone", sign_key: null }), "x").approves).toBe(false);
  });

  it("a browser approves only with a passkey; its own sign key doesn't count", () => {
    expect(deviceView(row({ kind: "browser", sign_key: "s" }), "x").approves).toBe(false);
    expect(deviceView(row({ kind: "browser", passkey_key: "pk" }), "x")).toMatchObject({ approves: true, hasPasskey: true });
  });

  it("a worker is never here, and an unknown kind reads as a Mac", () => {
    expect(deviceView(row({ kind: "worker", host: "here-id" }), "here-id").here).toBe(false);
    expect(deviceView(row({ kind: "fridge" }), "elsewhere")).toMatchObject({ kind: "mac", here: false });
  });

  it("holds nothing when it has no keys", () => {
    expect(deviceView(row({ box_key: null }), "x").hasBoxKey).toBe(false);
  });
});

describe("sortDevices", () => {
  it("puts live devices first, then Macs, workers, phones and browsers, then names", () => {
    const sorted = sortDevices([
      deviceView(row({ id: "b", kind: "browser", name: "A" }), "x"),
      deviceView(row({ id: "r", kind: "mac", name: "A", revoked_at: "t" }), "x"),
      deviceView(row({ id: "w2", kind: "worker", name: "Z" }), "x"),
      deviceView(row({ id: "w1", kind: "worker", name: "B" }), "x"),
      deviceView(row({ id: "m", kind: "mac", name: "M" }), "x"),
      deviceView(row({ id: "p", kind: "phone", name: "A" }), "x"),
    ]);
    expect(sorted.map((d) => d.id)).toEqual(["m", "w1", "w2", "p", "b", "r"]);
  });
});

describe("listDevices", () => {
  it("reads your rows from the registry with named columns", async () => {
    const { client, calls } = fakeClient({ data: [row()] });
    const view = await listDevices(client, "here-id");
    expect(view.signedIn).toBe(true);
    expect(view.devices[0]).toMatchObject({ id: "d1", here: true });
    expect(calls[0]).toEqual(["from", "device_registry"]);
    expect(String(calls[1]![1])).not.toContain("*");
    expect(calls[2]).toEqual(["eq", "owner_user", "u1"]);
  });

  it("puts each worker's own note on its row, and only a worker's", async () => {
    const notes = [{ id: "w1", update_note: "Browser runs without sandbox: it runs as root." }, { id: "w2", update_note: null }];
    const { client, calls } = fakeClient({ data: [row(), row({ id: "w1", kind: "worker" }), row({ id: "w2", kind: "worker" })], notes });
    const { devices } = await listDevices(client, "here-id");
    expect(calls).toContainEqual(["from", "cloud_workers"]);
    expect(calls).toContainEqual(["in", "id", ["w1", "w2"]]);
    expect(devices.map((d) => d.note)).toEqual([null, "Browser runs without sandbox: it runs as root.", null]);
    expect(deviceView(row(), "x", "a note").note).toBeNull();
  });

  it("leaves the notes off when they can't be read, and doesn't ask with no workers", async () => {
    const { client } = fakeClient({ data: [row({ id: "w1", kind: "worker" })] });
    expect((await listDevices(client)).devices[0]!.note).toBeNull();
    const macs = fakeClient({ data: [row()] });
    await listDevices(macs.client);
    expect(macs.calls).not.toContainEqual(["from", "cloud_workers"]);
  });

  it("is empty when signed out", async () => {
    const { client, calls } = fakeClient({ user: null });
    expect(await listDevices(client)).toEqual({ signedIn: false, devices: [] });
    expect(calls).toEqual([]);
  });

  it("says why it couldn't read", async () => {
    const { client } = fakeClient({ error: { message: 'relation "device_registry" does not exist' } });
    await expect(listDevices(client)).rejects.toThrow('Couldn\'t read your devices: relation "device_registry" does not exist');
  });

  it("takes no rows as none, and defaults to the account client and this Mac's id", async () => {
    const { client } = fakeClient({ data: null });
    expect((await listDevices(client)).devices).toEqual([]);
    await expect(listDevices()).rejects.toThrow();
  });
});

describe("revokeDevice", () => {
  it("calls device_revoke and says the kind", async () => {
    const { client, calls } = fakeClient();
    expect(await revokeDevice("w1", client)).toEqual({ kind: "worker" });
    expect(calls).toContainEqual(["rpc", "device_revoke", { p_id: "w1" }]);
  });

  it("needs a sign-in", async () => {
    const { client, calls } = fakeClient({ user: null });
    await expect(revokeDevice("w1", client)).rejects.toThrow("Sign in to Weft to revoke a device.");
    expect(calls).toEqual([]);
  });

  it("passes the server's refusal on", async () => {
    const { client } = fakeClient({ rpc: { data: null, error: { message: "That isn't one of your devices." } } });
    await expect(revokeDevice("x", client)).rejects.toThrow("Couldn't revoke that device: That isn't one of your devices.");
  });

  it("defaults to the account client", async () => {
    await expect(revokeDevice("x")).rejects.toThrow();
  });
});
