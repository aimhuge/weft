import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "./runner-state";

// Weft's tools for an Antigravity thread (lib/antigravity-mcp.ts): a stdio relay per server, each holding the bridge
// token in its own env. The bridge and the servers are faked: lib/mcp-bridge.ts and lib/weft-mcp.ts have their tests.

const s = vi.hoisted(() => ({ closed: 0, servers: [] as unknown[][], bridged: [] as (() => unknown)[] }));

vi.mock("./mcp-bridge", () => ({
  BRIDGE_TOKEN_ENV: "WEFT_MCP_TOKEN",
  openBridge: (servers: () => unknown) => (s.bridged.push(servers), { token: "tok", close: () => { s.closed++; } }),
}));
vi.mock("./weft-mcp", () => ({ weftMcpServers: (spec: unknown, cardId: () => unknown) => (s.servers.push([spec, cardId()]), { browser: {}, board: {} }) }));

const m = await import("./antigravity-mcp");

beforeEach(() => {
  s.closed = 0;
  s.servers.length = 0;
  s.bridged.length = 0;
});

describe("acpMcpServers", () => {
  it("is a relay per server, pointed at its bridge route, with the token and Electron's run-as-node in its env", () => {
    expect(m.acpMcpServers("http://127.0.0.1:5", ["browser", "board"], "tok", "/bin/node", "/r.mjs")).toEqual([
      { name: "browser", command: "/bin/node", args: ["/r.mjs", "http://127.0.0.1:5/api/mcp/browser"], env: [{ name: "WEFT_MCP_TOKEN", value: "tok" }, { name: "ELECTRON_RUN_AS_NODE", value: "1" }] },
      { name: "board", command: "/bin/node", args: ["/r.mjs", "http://127.0.0.1:5/api/mcp/board"], env: [{ name: "WEFT_MCP_TOKEN", value: "tok" }, { name: "ELECTRON_RUN_AS_NODE", value: "1" }] },
    ]);
  });
});

describe("relayScript", () => {
  it("is scripts/weft-mcp-relay.mjs in Weft's folder, the server's own by default", () => {
    expect(m.relayScript("/weft")).toBe(path.join("/weft", "scripts", "weft-mcp-relay.mjs"));
    expect(m.relayScript()).toBe(path.join(process.cwd(), "scripts", "weft-mcp-relay.mjs"));
  });
});

describe("openAgyMcp", () => {
  it("opens nothing outside the server", () => {
    const out = m.openAgyMcp({ spec: {} } as unknown as Session, "");
    expect(out.servers).toEqual([]);
    out.close();
    expect(s.bridged).toEqual([]);
  });

  it("opens a bridge for the card's servers and a relay to each, closed together", () => {
    const session = { cardId: "card-1", spec: { cwd: "/w" } } as unknown as Session;
    const out = m.openAgyMcp(session, "4321");
    expect(out.servers.map((x) => x.name)).toEqual(["browser", "board"]);
    expect(out.servers[0]).toMatchObject({ command: process.execPath, args: [m.relayScript(), "http://127.0.0.1:4321/api/mcp/browser"], env: [{ name: "WEFT_MCP_TOKEN", value: "tok" }, expect.anything()] });
    // The bridge builds the servers again each time it's asked, for the card the session has then.
    s.bridged[0]?.();
    session.cardId = null;
    s.bridged[0]?.();
    expect(s.servers.map((x) => x[1])).toEqual(["card-1", "card-1", undefined]);
    out.close();
    expect(s.closed).toBe(1);
  });

  it("reads the server's port from PORT by default", () => {
    vi.stubEnv("PORT", "9");
    try {
      expect(m.openAgyMcp({ cardId: "c", spec: {} } as unknown as Session).servers[0]?.args[1]).toBe("http://127.0.0.1:9/api/mcp/browser");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
