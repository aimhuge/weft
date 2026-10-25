import { describe, expect, it, vi } from "vitest";
import { createVercelEnv, envRoutes } from "./vercel-env.cjs";

// The vault ⇄ Vercel drift main answers from its cached lists (electron/vercel-env-cache.cjs), and the narrow Push.

describe("vercel-env drift", () => {
  const names = { label: "o/web", secrets: [{ name: "KEY", environment: "preview", missing: false }] };
  const list = { project: "web", envs: [{ id: "e1", key: "PLAIN", targets: ["preview"], type: "plain" }] };

  function drifting(linked = (f: string) => f !== "/unlinked") {
    const onDrift = vi.fn();
    const vault = { names: vi.fn((f: string) => (f === "/novault" ? Promise.reject(new Error("no vault")) : Promise.resolve(names))) };
    const vercel = { envList: vi.fn(() => Promise.resolve(list)) };
    return { env: createVercelEnv({ vercel, vault, onDrift, linked }), vercel, onDrift };
  }
  const settle = () => new Promise((r) => setImmediate(r));

  it("answers from the cache, fetching a missing list behind and saying when it lands", async () => {
    const { env, vercel, onDrift } = drifting();
    expect(await env.drift(["/web", "/unlinked"])).toEqual([]);
    await settle();
    expect(vercel.envList).toHaveBeenCalledTimes(1);
    expect(onDrift).toHaveBeenCalledWith("/web");
    expect(await env.drift(["/web", "/unlinked"])).toEqual([
      {
        folder: "/web",
        label: "o/web",
        project: "web",
        rows: [
          { name: "KEY", environment: "preview", inVault: true, onVercel: false },
          { name: "PLAIN", environment: "preview", inVault: false, onVercel: true, pullable: true },
        ],
      },
    ]);
  });

  it("skips a folder whose vault can't be read", async () => {
    const { env } = drifting(() => true);
    await env.status("/novault").catch(() => null);
    await env.drift(["/novault"]);
    await settle();
    expect(await env.drift(["/novault"])).toEqual([]);
  });

  it("keeps a status listing for the drift", async () => {
    const { env, vercel } = drifting();
    await env.status("/web");
    expect((await env.drift(["/web"]))[0]?.project).toBe("web");
    expect(vercel.envList).toHaveBeenCalledTimes(1);
  });

  it("pushes only the pairs asked for", async () => {
    const vercel = { envList: vi.fn(() => Promise.resolve({ project: "weft", envs: [] })), envSet: vi.fn(() => Promise.resolve({ pushed: true, project: "weft" })) };
    const values: Record<string, Record<string, string>> = { development: { KEY: "d" }, production: { KEY: "p", OTHER: "o" } };
    const vault = {
      names: vi.fn(() => Promise.resolve(names)),
      valuesFor: vi.fn((_f: string, _n: null, environment: string) => Promise.resolve({ label: "aimhuge/weft", values: values[environment] ?? {} })),
      confirm: vi.fn(() => Promise.resolve(true)),
    };
    const env = createVercelEnv({ vercel, vault });
    const r = await env.pushAll("/dev/weft", [{ name: "OTHER", environment: "production" }]);
    expect(r.sent).toEqual([{ name: "OTHER", environment: "production" }]);
    expect(vercel.envSet).toHaveBeenCalledTimes(1);
  });

  it("gives the copilot a drift route", async () => {
    const env = { drift: vi.fn(() => Promise.resolve([])) };
    const routes = envRoutes(() => env);
    await routes["POST /vercel/env-drift"]({ folders: ["/a", 2] });
    await routes["POST /vercel/env-drift"]({ folders: undefined });
    expect(env.drift).toHaveBeenCalledWith(["/a", "2"]);
    expect(env.drift).toHaveBeenCalledWith([]);
  });
});
