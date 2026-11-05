import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// lib/app-share-republish.ts: a shared folder app syncs to weft.zip after a rebuild. The app list and the sync are
// injected, so no Supabase or real upload runs; isDeployed and the share module are mocked at the edge.

const deployed = vi.hoisted(() => ({ value: false }));
vi.mock("./home", () => ({ isDeployed: () => deployed.value }));
vi.mock("./app-share", () => ({ readAppShare: vi.fn(() => Promise.resolve({ kind: "ok" })) }));
vi.mock("./mini-app-store", () => ({ listApps: vi.fn(() => []) }));

const { APPS_DIR } = await import("./app-build");
const { readAppShare } = await import("./app-share");
const { listApps } = await import("./mini-app-store");
const { sharedAppIdsIn, republishSharedApps, republishScheduler } = await import("./app-share-republish");

const fileUrl = (slug: string, entry = "index.html") => `file://${path.join(APPS_DIR(), slug, entry)}`;
const shared = { id: "s1", mode: "public" as const, hasPassword: false };
const apps = [
  { id: "a1", name: "Growth", url: fileUrl("growth"), addedAt: 1, share: shared },
  { id: "a2", name: "Growth, unshared", url: fileUrl("growth"), addedAt: 1 },
  { id: "a3", name: "Taken down", url: fileUrl("growth"), addedAt: 1, share: { ...shared, id: null } },
  { id: "a4", name: "Other", url: fileUrl("other"), addedAt: 1, share: shared },
  { id: "a5", name: "A site", url: "https://example.com/", addedAt: 1, share: shared },
];

afterEach(() => {
  deployed.value = false;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("sharedAppIdsIn", () => {
  it("picks only the apps in that folder with a live share link", () => {
    expect(sharedAppIdsIn("growth", apps)).toEqual(["a1"]);
    expect(sharedAppIdsIn("other", apps)).toEqual(["a4"]);
    expect(sharedAppIdsIn("none", apps)).toEqual([]);
  });
});

describe("republishSharedApps", () => {
  it("syncs each shared app in the folder", async () => {
    const sync = vi.fn(() => Promise.resolve());
    expect(await republishSharedApps("growth", { apps: () => apps, sync })).toEqual(["a1"]);
    expect(sync).toHaveBeenCalledWith("a1");
  });

  it("defaults to the saved apps and Share…'s own sync", async () => {
    vi.mocked(listApps).mockReturnValue(apps);
    expect(await republishSharedApps("other")).toEqual(["a4"]);
    expect(readAppShare).toHaveBeenCalledWith("a4");
  });

  it("does nothing on a deployed server", async () => {
    deployed.value = true;
    const sync = vi.fn();
    expect(await republishSharedApps("growth", { apps: () => apps, sync })).toEqual([]);
    expect(sync).not.toHaveBeenCalled();
  });

  it("logs a failed sync and carries on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const two = [...apps, { ...apps[0]!, id: "a6" }];
    const sync = vi.fn()
      .mockRejectedValueOnce(new Error("quota"))
      .mockRejectedValueOnce("offline");
    expect(await republishSharedApps("growth", { apps: () => two, sync })).toEqual(["a1", "a6"]);
    expect(warn).toHaveBeenCalledWith("[weft/app-share] republish growth failed: quota");
    expect(warn).toHaveBeenCalledWith("[weft/app-share] republish growth failed: offline");
    warn.mockRestore();
  });
});

describe("republishScheduler", () => {
  it("coalesces builds of one folder into one run after the last", () => {
    vi.useFakeTimers();
    const run = vi.fn(() => Promise.resolve());
    const s = republishScheduler({ run, debounceMs: 100 });
    s.schedule("growth");
    vi.advanceTimersByTime(60);
    s.schedule("growth");
    s.schedule("other");
    expect(s.pendingCount()).toBe(2);
    vi.advanceTimersByTime(99);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledWith("growth");
    expect(s.pendingCount()).toBe(0);
  });

  it("stop drops what's pending", () => {
    vi.useFakeTimers();
    const run = vi.fn(() => Promise.resolve());
    const s = republishScheduler({ run });
    s.schedule("growth");
    s.stop();
    vi.advanceTimersByTime(10_000);
    expect(run).not.toHaveBeenCalled();
    expect(s.pendingCount()).toBe(0);
  });

  it("runs the real republish by default", async () => {
    vi.useFakeTimers();
    vi.mocked(listApps).mockReturnValue(apps);
    const s = republishScheduler();
    s.schedule("growth");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(readAppShare).toHaveBeenCalledWith("a1");
  });
});
