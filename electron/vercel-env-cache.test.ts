import { describe, expect, it, vi } from "vitest";
import { createEnvCache, TTL_MS } from "./vercel-env-cache.cjs";

// Each linked folder's Vercel list, kept so the drift never waits on Vercel: fetched behind, refreshed by real listings.

function make({ linked = true, fail = false } = {}) {
  let t = 1_000;
  const queued: (() => unknown)[] = [];
  let n = 0;
  const list = vi.fn(() => (fail ? Promise.reject(new Error("signed out")) : Promise.resolve({ project: "web", envs: [{ key: `K${n++}` }] })));
  const onChange = vi.fn();
  const cache = createEnvCache({ list, linked: () => linked, onChange, now: () => t, later: (fn: () => unknown) => queued.push(fn) });
  const flush = async () => {
    for (const fn of queued.splice(0)) await fn();
  };
  return { cache, list, onChange, flush, tick: (ms: number) => (t += ms) };
}

describe("vercel-env-cache", () => {
  it("answers nothing at first and fetches behind, once", async () => {
    const { cache, list, onChange, flush } = make();
    expect(cache.peek("/web")).toBeNull();
    expect(cache.peek("/web")).toBeNull();
    expect(list).not.toHaveBeenCalled();
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("/web");
    expect(cache.peek("/web")).toEqual({ project: "web", envs: [{ key: "K0" }] });
  });

  it("fetches again only once stale", async () => {
    const { cache, list, flush, tick } = make();
    cache.peek("/web");
    await flush();
    cache.peek("/web");
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
    tick(TTL_MS + 1);
    expect(cache.peek("/web")).toEqual({ project: "web", envs: [{ key: "K0" }] });
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("leaves an unlinked folder alone", async () => {
    const { cache, list, flush } = make({ linked: false });
    expect(cache.peek("/web")).toBeNull();
    await flush();
    expect(list).not.toHaveBeenCalled();
  });

  it("keeps what it had when Vercel fails, and waits out the TTL", async () => {
    const { cache, list, onChange, flush } = make({ fail: true });
    cache.peek("/web");
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(cache.peek("/web")).toBeNull();
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("keeps a real listing and tells the board only when it changed", async () => {
    const { cache, onChange } = make();
    expect(await cache.listed("/web")).toEqual({ project: "web", envs: [{ key: "K0" }] });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(cache.peek("/web")).toEqual({ project: "web", envs: [{ key: "K0" }] });
    await cache.listed("/web");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when a listing says the same", async () => {
    const onChange = vi.fn();
    const cache = createEnvCache({ list: () => Promise.resolve({ envs: [] }), linked: () => true, onChange });
    await cache.listed("/web");
    await cache.listed("/web");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("defaults to no listener", async () => {
    const cache = createEnvCache({ list: () => Promise.resolve({ envs: [] }), linked: () => true });
    expect(await cache.listed("/web")).toEqual({ envs: [] });
  });
});
