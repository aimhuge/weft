import { describe, expect, it, vi } from "vitest";
import type { DevServerEntry } from "./types";
import { createDevPublisher, devServersNow, redactCommand, type WorkerDevServer } from "./worker-dev-servers";

const entry = (over: Partial<DevServerEntry> = {}): DevServerEntry => ({ cardId: "c1", cwd: "/work/weft", command: "pnpm dev", state: "running", startedAt: 1, source: "weft", ...over });

describe("devServersNow", () => {
  it("puts each server on the wire by folder name, with its tunnel's address when one is open", async () => {
    const list = () => Promise.resolve([entry({ title: "T".repeat(100), url: "http://localhost:3000" }), entry({ cardId: "c2", url: "http://localhost:4000", source: "thread" }), entry({ cardId: "c3" })]);
    const tunnel = (url: string) => (url.includes("3000") ? { address: "https://weft.zip/t/t1" } : undefined);
    const got = await devServersNow(list, tunnel as never);
    expect(got[0]).toEqual({ cardId: "c1", folder: "weft", command: "pnpm dev", url: "http://localhost:3000", state: "running", startedAt: 1, source: "weft", address: "https://weft.zip/t/t1" });
    expect(got[1]).toEqual({ cardId: "c2", folder: "weft", command: "pnpm dev", url: "http://localhost:4000", state: "running", startedAt: 1, source: "thread" });
    expect(got[2]).not.toHaveProperty("url");
  });

  it("leaves out the card's title and any inline env value, since the whole workspace reads the row", async () => {
    const got = await devServersNow(() => Promise.resolve([entry({ title: "Secret plan", command: "API_KEY=sk_live_1 X='a b' pnpm dev --port=3000" })]), () => undefined);
    expect(got[0]).not.toHaveProperty("title");
    expect(got[0]?.command).toBe("API_KEY=… X=… pnpm dev --port=3000");
    expect(redactCommand("pnpm dev")).toBe("pnpm dev");
    expect(redactCommand("x".repeat(300))).toHaveLength(200);
  });

  it("keeps the list to twenty", async () => {
    const many = Array.from({ length: 30 }, (_, i) => entry({ cardId: `c${i}` }));
    expect(await devServersNow(() => Promise.resolve(many))).toHaveLength(20);
  });
});

describe("createDevPublisher", () => {
  it("puts the list only when it changed, and tries again after a failure", async () => {
    let now: WorkerDevServer[] = [];
    const put = vi.fn(() => Promise.resolve());
    const publish = createDevPublisher(put, () => Promise.resolve(now));
    await publish();
    await publish();
    expect(put).toHaveBeenCalledTimes(1);
    now = [{ cardId: "c1", folder: "weft", command: "pnpm dev", state: "running", startedAt: 1, source: "weft" }];
    put.mockRejectedValueOnce(new Error("offline"));
    const log = vi.fn();
    const failing = createDevPublisher(put, () => Promise.resolve(now), log);
    await failing();
    expect(log).toHaveBeenCalledWith("Weft Worker: publishing dev servers: offline");
    await failing();
    expect(put).toHaveBeenLastCalledWith(now);
  });

  it("reads this box's own list by default", async () => {
    const put = vi.fn(() => Promise.resolve());
    await createDevPublisher(put)();
    expect(put).toHaveBeenCalledWith([]);
  });
});
