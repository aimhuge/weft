import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));
const sync = vi.hoisted(() => ({ syncOrgId: vi.fn(() => Promise.resolve("home" as string | null)) }));
vi.mock("./cloud-sync", () => sync);
vi.mock("./cloud-sync-route", () => ({ orgForFolder: vi.fn(() => Promise.resolve("org-9")) }));
const devices = vi.hoisted(() => ({ listDevices: vi.fn() }));
vi.mock("./device-registry", () => devices);

const { sendMacSnapshot, macSource, parseMacSource } = await import("./mac-host-verbs");

const DEVICE = "ab".repeat(8);
function client(over: { user?: string | null; error?: { message: string } | null } = {}) {
  const inserted: unknown[] = [];
  const c = {
    auth: { getSession: () => Promise.resolve({ data: { session: over.user === null ? null : { user: { id: "u1" } } } }) },
    from: () => ({
      insert: (row: unknown) => (inserted.push(row), { select: () => ({ single: () => Promise.resolve({ data: over.error ? null : { id: "cmd-5" }, error: over.error ?? null }) }) }),
    }),
  } as unknown as SupabaseClient;
  return { c, inserted };
}
const mac = (over: Record<string, unknown> = {}) => ({ kind: "mac", host: DEVICE, here: false, revokedAt: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  sync.syncOrgId.mockResolvedValue("home");
  devices.listDevices.mockResolvedValue({ devices: [mac()] });
});

describe("sendMacSnapshot", () => {
  it("queues tree.snapshot for the other Mac, naming the project by folder name", async () => {
    const { c, inserted } = client();
    expect(await sendMacSnapshot({ device: DEVICE, folder: "weft" }, "/dev/weft", { origin: "me/weft", widen: { k: 1 } }, c)).toEqual({ commandId: "cmd-5" });
    expect(inserted).toEqual([
      { org_id: "org-9", kind: "host", target_device: DEVICE, folder: "weft", payload: { verb: "tree.snapshot", args: { origin: "me/weft", widen: { k: 1 }, folder: "weft", id: "" } } },
    ]);
  });

  it("asks you to sign in, and refuses a Mac that isn't another of yours", async () => {
    const src = { device: DEVICE, folder: "weft" };
    await expect(sendMacSnapshot(src, "/p", {}, client({ user: null }).c)).rejects.toThrow("Sign in to Weft");
    sync.syncOrgId.mockResolvedValueOnce(null);
    await expect(sendMacSnapshot(src, "/p", {}, client().c)).rejects.toThrow("Sign in to Weft");
    for (const d of [[], [mac({ here: true })], [mac({ revokedAt: "t" })], [mac({ kind: "phone" })], [mac({ host: "other" })]]) {
      devices.listDevices.mockResolvedValueOnce({ devices: d });
      await expect(sendMacSnapshot(src, "/p", {}, client().c)).rejects.toThrow("isn't one of your other Macs");
    }
  });

  it("says when the insert fails", async () => {
    await expect(sendMacSnapshot({ device: DEVICE, folder: "w" }, "/p", {}, client({ error: { message: "denied" } }).c)).rejects.toThrow("Couldn't reach your other Mac: denied");
  });

  it("re-exports the source helpers", () => {
    expect(parseMacSource(macSource(DEVICE, "w"))).toEqual({ device: DEVICE, folder: "w" });
  });
});
