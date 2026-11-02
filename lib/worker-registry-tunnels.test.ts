import { describe, expect, it, vi } from "vitest";
import { registry, type Rpc } from "./worker-registry";

function fakeRpc(data: unknown = null) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return Promise.resolve({ data, error: null });
  });
  return { rpc: rpc as unknown as Rpc, calls };
}

describe("the worker's tunnel, relay and dev server calls", () => {
  const key = "wwk_key";

  it("asks the Mac with the card, tool and args", async () => {
    const { rpc, calls } = fakeRpc("call-1");
    expect(await registry(rpc, key).macAsk("c1", "tunnel_open", { tunnel: "t1" })).toBe("call-1");
    expect(calls).toEqual([{ fn: "worker_mac_ask", args: { p_key: key, p_card: "c1", p_tool: "tunnel_open", p_args: { tunnel: "t1" } } }]);
  });

  it("publishes and closes a tunnel through its key", async () => {
    const { rpc, calls } = fakeRpc("2026-11-02T20:00:00Z");
    const reg = registry(rpc, key);
    expect(await reg.tunnelOpen("t1", "https://a.trycloudflare.com", "ab")).toBe("2026-11-02T20:00:00Z");
    await expect(reg.tunnelClose("t1")).resolves.toBeUndefined();
    expect(calls).toEqual([
      { fn: "worker_tunnel_open", args: { p_key: key, p_tunnel: "t1", p_url: "https://a.trycloudflare.com", p_secret: "ab" } },
      { fn: "worker_tunnel_close", args: { p_key: key, p_tunnel: "t1" } },
    ]);
  });

  it("puts its dev servers on its row", async () => {
    const { rpc, calls } = fakeRpc();
    await registry(rpc, key).setDevServers([{ cardId: "c1" }]);
    expect(calls).toEqual([{ fn: "worker_set_dev_servers", args: { p_key: key, p_servers: [{ cardId: "c1" }] } }]);
  });
});
