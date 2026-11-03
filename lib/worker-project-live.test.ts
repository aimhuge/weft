// A worker's new project snapshot heard live (lib/worker-project-live.ts): one subscription per workspace, an event per
// changed row, and a channel that fails (no table in the publication yet) left to the badges' own reads for a while.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const publish = vi.hoisted(() => vi.fn());
vi.mock("./bus", () => ({ publish }));

const { RETRY_MS, projectOfChange, watchWorkerProjects } = await import("./worker-project-live");

type Change = (payload: unknown) => void;
type Status = (status: string, err?: Error) => void;

function fakeClient() {
  const channels: { topic: string; opts: unknown; change: Change; status: Status }[] = [];
  const removeChannel = vi.fn(() => Promise.resolve("ok"));
  const client = {
    channel: vi.fn((topic: string) => {
      const entry = { topic, opts: null as unknown, change: (() => {}) as Change, status: (() => {}) as Status };
      const ch = {
        on: (_kind: string, opts: unknown, fn: Change) => {
          entry.opts = opts;
          entry.change = fn;
          return ch;
        },
        subscribe: (fn: Status) => {
          entry.status = fn;
          return ch;
        },
      };
      channels.push(entry);
      return ch;
    }),
    removeChannel,
  };
  return { client: client as never, channels, removeChannel, raw: client };
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__weftWorkerProjectLive;
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe("projectOfChange", () => {
  it("names the new row's project, or the old one's for a delete, or none", () => {
    expect(projectOfChange({ new: { worker_id: "w1", folder: "ling" } })).toBe("worker://w1/ling");
    expect(projectOfChange({ new: {}, old: { worker_id: "w1", folder: "gone" } })).toBe("worker://w1/gone");
    expect(projectOfChange({ new: { worker_id: "w1" } })).toBeNull();
    expect(projectOfChange({})).toBeNull();
  });
});

describe("watchWorkerProjects", () => {
  it("subscribes once for the workspace's rows and tells the board about each change", () => {
    const f = fakeClient();
    watchWorkerProjects(f.client, "org-1");
    watchWorkerProjects(f.client, "org-1");
    expect(f.raw.channel).toHaveBeenCalledTimes(1);
    expect(f.channels.at(0)?.topic).toBe("worker-projects-org-1");
    expect(f.channels.at(0)?.opts).toEqual({ event: "*", schema: "public", table: "cloud_worker_projects", filter: "org_id=eq.org-1" });
    f.channels.at(0)?.status("SUBSCRIBED");
    f.channels.at(0)?.change({ new: { worker_id: "w1", folder: "ling" } });
    f.channels.at(0)?.change({ new: {} });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({ type: "worker_project", project: "worker://w1/ling" });
  });

  it("moves to a new workspace, leaving the old channel", () => {
    const f = fakeClient();
    watchWorkerProjects(f.client, "org-1");
    watchWorkerProjects(f.client, "org-2");
    expect(f.channels.map((c) => c.topic)).toEqual(["worker-projects-org-1", "worker-projects-org-2"]);
    expect(f.removeChannel).toHaveBeenCalledTimes(1);
    // The old channel closing doesn't touch the new one.
    f.channels.at(0)?.status("CLOSED");
    watchWorkerProjects(f.client, "org-2");
    expect(f.raw.channel).toHaveBeenCalledTimes(2);
  });

  it("leaves a failed channel to the badges' reads, says so once, and tries again after a while", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeClient();
    const t0 = Date.now();
    watchWorkerProjects(f.client, "org-1", t0);
    f.channels.at(0)?.status("CHANNEL_ERROR", new Error("Unable to subscribe to changes"));
    f.channels.at(0)?.status("CLOSED");
    expect(f.removeChannel).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls.at(0)?.[0])).toContain("Unable to subscribe");
    watchWorkerProjects(f.client, "org-1", t0 + 1_000);
    expect(f.raw.channel).toHaveBeenCalledTimes(1);
    watchWorkerProjects(f.client, "org-1", t0 + RETRY_MS + 1_000);
    expect(f.raw.channel).toHaveBeenCalledTimes(2);
    f.channels.at(1)?.status("TIMED_OUT");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("says why without an error, and shrugs off a channel that won't come down", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeClient();
    f.removeChannel.mockImplementation(() => Promise.reject(new Error("socket gone")));
    watchWorkerProjects(f.client, "org-1");
    watchWorkerProjects(f.client, "org-2");
    f.channels.at(1)?.status("TIMED_OUT");
    await Promise.resolve();
    expect(String(warn.mock.calls.at(0)?.[0])).toContain("(TIMED_OUT)");
    expect(f.removeChannel).toHaveBeenCalledTimes(2);
  });
});
