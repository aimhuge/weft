import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const syncOrgId = vi.fn<(client: unknown, uid: string) => Promise<string | null>>();
vi.mock("./cloud-sync", () => ({ syncOrgId: (client: unknown, uid: string) => syncOrgId(client, uid) }));
vi.mock("./device-id", () => ({ deviceId: () => "dev-1" }));
const sessions = new Map<string, { busy: boolean }>();
vi.mock("./runner-state", () => ({ sessions }));

const { beatDesktopWorker, desktopName } = await import("./desktop-worker");

function fakeClient(error: { message: string } | null = null) {
  const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<unknown>>(() => Promise.resolve({ data: "w-1", error }));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sessions.clear();
  syncOrgId.mockReset();
  syncOrgId.mockResolvedValue("org-1");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("desktopName", () => {
  it("drops .local, and falls back when there's no name", () => {
    expect(desktopName("Alexs-MacBook-Air.local")).toBe("Alexs-MacBook-Air");
    expect(desktopName("")).toBe("This Mac");
    expect(desktopName("x".repeat(90))).toHaveLength(80);
    expect(desktopName().length).toBeGreaterThan(0);
  });
});

describe("beatDesktopWorker", () => {
  it("beats this device into the workspace it syncs to, online when idle", async () => {
    const { client, rpc } = fakeClient();
    await beatDesktopWorker(client, "u-1");
    expect(syncOrgId).toHaveBeenCalledWith(client, "u-1");
    expect(rpc).toHaveBeenCalledWith("desktop_worker_beat", expect.objectContaining({ p_org: "org-1", p_device: "dev-1", p_platform: process.platform, p_arch: process.arch, p_status: "online" }));
  });

  it("says busy while a thread runs", async () => {
    sessions.set("c", { busy: true });
    const { client, rpc } = fakeClient();
    await beatDesktopWorker(client, "u-1");
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_status: "busy" });
  });

  it("does nothing outside a workspace", async () => {
    syncOrgId.mockResolvedValue(null);
    const { client, rpc } = fakeClient();
    await beatDesktopWorker(client, "u-1");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("warns and carries on when the beat fails or throws", async () => {
    await beatDesktopWorker(fakeClient({ message: "no function" }).client, "u-1");
    expect(warn).toHaveBeenCalledWith("Desktop worker: no function");
    syncOrgId.mockRejectedValue(new Error("offline"));
    await beatDesktopWorker(fakeClient().client, "u-1");
    expect(warn).toHaveBeenCalledWith("Desktop worker: offline");
  });
});
