import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardEvent } from "./types";

vi.mock("./account", () => ({ accountClient: () => fakeClient() }));
vi.mock("./device-id", () => ({ deviceId: () => "dev-1" }));
const listeners = vi.hoisted(() => new Set<(e: BoardEvent) => void>());
vi.mock("./bus", () => ({
  subscribe: (fn: (e: BoardEvent) => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
}));
const stored = vi.hoisted(() => ({ folders: [] as string[] }));
vi.mock("./settings", () => ({ syncFolders: () => stored.folders }));

const { changedOnly, MAC_PROJECT_CAP, macProjects, putMacProjects, startMacProjectsPublish } = await import("./mac-projects");
const { REPUBLISH_MS } = await import("./mac-publish");

const upserts: unknown[] = [];
function fakeClient({ session = true, error = null as { message: string } | null } = {}) {
  return {
    auth: { getSession: () => Promise.resolve({ data: { session: session ? { user: { id: "u1" } } : null } }) },
    from: (table: string) => ({
      upsert: (row: unknown, opts: unknown) => {
        upserts.push({ table, row, opts });
        return Promise.resolve({ error });
      },
    }),
  } as never;
}

beforeEach(() => {
  upserts.length = 0;
  listeners.clear();
  stored.folders = [];
});
afterEach(() => vi.useRealTimers());

describe("macProjects", () => {
  it("is the folders Sync is on for, capped, and this Mac's home", () => {
    stored.folders = ["/Users/me/app"];
    expect(macProjects().folders).toEqual(["/Users/me/app"]);
    expect(macProjects().home).toBe(os.homedir());
    expect(macProjects(Array.from({ length: MAC_PROJECT_CAP + 5 }, (_, i) => `/p/${i}`), "/Users/me").folders).toHaveLength(MAC_PROJECT_CAP);
  });
});

describe("putMacProjects", () => {
  it("upserts this Mac's row as the signed-in user", async () => {
    expect(await putMacProjects({ home: "/Users/me", folders: ["/Users/me/app"] }, fakeClient(), "dev-1")).toBe(true);
    expect(upserts).toMatchObject([{ table: "cloud_mac_projects", row: { owner_user: "u1", device: "dev-1", home: "/Users/me", folders: ["/Users/me/app"] }, opts: { onConflict: "owner_user,device" } }]);
  });

  it("writes nothing signed out, and throws the database's error", async () => {
    expect(await putMacProjects({ home: "", folders: [] }, fakeClient({ session: false }))).toBe(false);
    await expect(putMacProjects({ home: "", folders: [] }, fakeClient({ error: { message: "no table" } }))).rejects.toThrow("no table");
  });

  it("uses the account client and this Mac's id by default", async () => {
    expect(await putMacProjects({ home: "", folders: [] })).toBe(true);
    expect(upserts[0]).toMatchObject({ row: { device: "dev-1" } });
  });
});

describe("changedOnly", () => {
  it("skips the same value until REPUBLISH_MS has passed, and sends a changed one at once", async () => {
    let now = 0;
    const put = vi.fn(() => Promise.resolve());
    const send = changedOnly(put, () => now);
    const a = { home: "/h", folders: ["/a"] };
    await send(a);
    await send(a);
    expect(put).toHaveBeenCalledTimes(1);
    await send({ home: "/h", folders: ["/a", "/b"] });
    expect(put).toHaveBeenCalledTimes(2);
    now = REPUBLISH_MS;
    await send({ home: "/h", folders: ["/a", "/b"] });
    expect(put).toHaveBeenCalledTimes(3);
  });

  it("tries again after a failed put", async () => {
    const put = vi.fn<() => Promise<unknown>>(() => Promise.reject(new Error("x")));
    const send = changedOnly(put);
    await expect(send({ home: "", folders: [] })).rejects.toThrow("x");
    put.mockResolvedValueOnce(true);
    await send({ home: "", folders: [] });
    expect(put).toHaveBeenCalledTimes(2);
  });
});

describe("startMacProjectsPublish", () => {
  it("publishes at once, after a projects event, and when a check finds the list changed", async () => {
    vi.useFakeTimers();
    const put = vi.fn(() => Promise.resolve());
    stored.folders = ["/a"];
    const stop = startMacProjectsPublish({ put, delayMs: 10 }, 1_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(put).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(put).toHaveBeenCalledTimes(1);
    stored.folders = ["/a", "/b"];
    for (const l of listeners) l({ type: "crons" });
    for (const l of listeners) l({ type: "projects", projects: [] });
    await vi.advanceTimersByTimeAsync(10);
    expect(put).toHaveBeenCalledTimes(2);
    stop();
    expect(listeners.size).toBe(0);
  });

  it("writes with the account by default", async () => {
    stored.folders = ["/Users/me/app"];
    const stop = startMacProjectsPublish();
    await vi.waitFor(() => expect(upserts).toHaveLength(1));
    expect(upserts[0]).toMatchObject({ row: { folders: ["/Users/me/app"] } });
    stop();
  });
});
