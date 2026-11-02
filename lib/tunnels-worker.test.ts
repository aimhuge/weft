// A tunnel on a Weft Worker (docs/architecture/tunnels.md#on-a-worker): the owner's Mac approves through a device
// call, the worker's key publishes the URL only after that, and the approval's end is the tunnel's.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MacLink } from "./worker-mac-ask";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-tunnels-worker-"));

vi.mock("./store", () => ({ DATA_DIR: dir }));
vi.mock("./site", () => ({ SITE: "https://weft.zip" }));
vi.mock("./webhooks", () => ({ listWebhooks: () => [] }));
vi.mock("./account", () => ({ accountClient: () => ({}) }));
vi.mock("./tunnel-cloudflared", () => ({
  ensureCloudflared: () => Promise.resolve("/bin/cloudflared"),
  startQuickTunnel: () => Promise.resolve({ url: "https://w.trycloudflare.com", stop: () => {} }),
}));

const { closeTunnel, listTunnels, openTunnel } = await import("./tunnels");
const { setMacLink } = await import("./worker-mac-ask");
const { workerTunnels } = await import("./tunnel-worker");

let answer: Record<string, unknown>;
const link = {
  ask: vi.fn<MacLink["ask"]>(() => Promise.resolve("call-1")),
  result: vi.fn<MacLink["result"]>(() => Promise.resolve({ status: "done", result: answer, error: null })),
  cancel: vi.fn<MacLink["cancel"]>(() => Promise.resolve(true)),
  tunnelOpen: vi.fn<MacLink["tunnelOpen"]>(() => Promise.resolve("2026-11-02T20:00:00Z")),
  tunnelClose: vi.fn<MacLink["tunnelClose"]>(() => Promise.resolve()),
};

beforeEach(() => {
  vi.stubEnv("WEFT_WORKER", "1");
  vi.clearAllMocks();
  answer = { approved: true, until: Date.now() + 60 * 60 * 1000 };
  setMacLink(link);
  fs.rmSync(path.join(dir, "tunnels.json"), { force: true });
});
afterEach(async () => {
  for (const t of listTunnels()) await closeTunnel(t.id);
  vi.unstubAllEnvs();
});

describe("a tunnel on a worker", () => {
  it("asks the owner's Mac for the card, then publishes the quick tunnel through its key", async () => {
    const at = Date.now();
    const t = await openTunnel({ folder: "/work/weft", target: "http://localhost:3000", hours: 4, cardId: "c1" }, at);
    expect(link.ask).toHaveBeenCalledWith("c1", "tunnel_open", { tunnel: t.id, target: "http://localhost:3000", hours: 4, folder: "weft" });
    expect(link.tunnelOpen).toHaveBeenCalledWith(t.id, "https://w.trycloudflare.com", expect.stringMatching(/^[0-9a-f]{64}$/));
    // The Mac's approval is the shorter of the two, so it's when the tunnel closes.
    expect(t.expiresAt).toBe(answer.until);
    await closeTunnel(t.id);
    expect(link.tunnelClose).toHaveBeenCalledWith(t.id);
  });

  it("opens nothing when the Mac says no, or when it says nothing of when", async () => {
    answer = { approved: false };
    await expect(openTunnel({ folder: "/w", target: "http://localhost:3000", cardId: "c1" })).rejects.toThrow(/Touch ID/);
    expect(link.tunnelOpen).not.toHaveBeenCalled();
    answer = { approved: true };
    expect(await workerTunnels.approve({ id: "t", folder: "/w", name: "n", target: "http://localhost:3000/" }, 1, "c1")).toEqual({});
  });

  it("needs its line to the Mac, and leaves a worker's relays to the database", async () => {
    setMacLink(null);
    await expect(workerTunnels.ready()).rejects.toThrow(/can't reach your Mac/);
    expect(workerTunnels.weftPort()).toBeUndefined();
    await expect(workerTunnels.linkRelays("http://localhost:3000/", "t")).resolves.toBeUndefined();
  });
});
