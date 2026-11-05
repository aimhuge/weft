// mcp__webhooks__relay, tunnel and close_tunnel: on a worker the relay goes through the owner's Mac, and the tunnel
// tools carry the card, which the Mac's approval is bound to.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<Result>;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: (options: { tools: Array<{ name: string; handler: Handler }> }) => options,
  tool: (name: string, _d: string, _s: unknown, handler: Handler) => ({ name, handler }),
}));
const createRelay = vi.hoisted(() => vi.fn());
const createRelayOnWorker = vi.hoisted(() => vi.fn());
const tunnels = vi.hoisted(() => ({ openTunnel: vi.fn(), closeTunnel: vi.fn(), listTunnels: vi.fn(() => [] as { id: string; target: string }[]) }));
vi.mock("./webhook-forward", () => ({ createRelay }));
vi.mock("./relay-worker", () => ({ createRelayOnWorker }));
vi.mock("./tunnels", () => ({ ...tunnels, DEFAULT_HOURS: 4, MAX_HOURS: 24 }));
vi.mock("./webhook-relays", () => ({ createRelays: vi.fn() }));
vi.mock("./webhooks", () => ({
  listWebhooks: () => [
    { id: "h1", name: "stripe", target: "http://localhost:3000/s", folder: "/proj" },
    { id: "h2", name: "github", target: "http://localhost:3000/g", folder: "/proj" },
  ],
  addWebhook: vi.fn(),
  updateWebhook: vi.fn(),
}));

const { webhooksMcpServer } = await import("./webhook-tools");
const server = webhooksMcpServer(() => "/proj", () => "c1") as unknown as { tools: Array<{ name: string; handler: Handler }> };
const run = (name: string, args: Record<string, unknown> = {}) => server.tools.find((t) => t.name === name)!.handler(args);
const said = (r: Result) => r.content[0]?.text ?? "";
const made = { name: "stripe", url: "https://weft.zip/api/hooks/r1", target: "http://localhost:3000/s" };

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe("relay", () => {
  it("goes through the owner's Mac on a worker, and says deliveries need its tunnel", async () => {
    vi.stubEnv("WEFT_WORKER", "1");
    createRelayOnWorker.mockResolvedValue(made);
    const r = await run("relay", { name: "stripe" });
    expect(createRelayOnWorker).toHaveBeenCalledWith("h1", "c1");
    expect(createRelay).not.toHaveBeenCalled();
    expect(said(r)).toContain("through this worker's tunnel to http://localhost:3000/s");
  });

  it("makes its own on the Mac", async () => {
    vi.stubEnv("WEFT_WORKER", "");
    createRelay.mockResolvedValue(made);
    expect(said(await run("relay", { name: "stripe" }))).toContain("to http://localhost:3000/s while Weft runs");
    expect(createRelay).toHaveBeenCalledWith("h1");
  });

  it("relays several on a worker one at a time through the owner's Mac, saying which failed", async () => {
    vi.stubEnv("WEFT_WORKER", "1");
    createRelayOnWorker.mockResolvedValueOnce(made).mockRejectedValueOnce(new Error("The Mac said no."));
    const r = await run("relay", { names: ["stripe", "github"] });
    expect(createRelayOnWorker.mock.calls).toEqual([["h1", "c1"], ["h2", "c1"]]);
    expect(said(r)).toContain("1 of 2 webhooks have a public URL");
    expect(said(r)).toContain("- github: no relay. The Mac said no.");
  });

  it("binds a server built without a card to none", async () => {
    vi.stubEnv("WEFT_WORKER", "1");
    createRelayOnWorker.mockResolvedValue(made);
    const bare = webhooksMcpServer(() => "/proj") as unknown as { tools: Array<{ name: string; handler: Handler }> };
    await bare.tools.find((t) => t.name === "relay")!.handler({ name: "stripe" });
    expect(createRelayOnWorker).toHaveBeenCalledWith("h1", undefined);
  });
});

describe("tunnel and close_tunnel", () => {
  it("opens one for the card, and says until when", async () => {
    tunnels.openTunnel.mockResolvedValue({ target: "http://localhost:3000/", address: "https://weft.zip/t/t1", expiresAt: Date.now() });
    expect(said(await run("tunnel", { target: "http://localhost:3000", hours: 2 }))).toContain("is open at https://weft.zip/t/t1");
    expect(tunnels.openTunnel).toHaveBeenCalledWith({ folder: "/proj", target: "http://localhost:3000", hours: 2, cardId: "c1" });
  });

  it("closes the project's tunnel to that server, or says there's none", async () => {
    expect(said(await run("close_tunnel", { target: "http://localhost:3000" }))).toBe("No tunnel is open to http://localhost:3000 in this project.");
    tunnels.listTunnels.mockReturnValue([{ id: "t1", target: "http://localhost:3000/" }]);
    expect(said(await run("close_tunnel", { target: "http://localhost:3000/x" }))).toBe("Closed the tunnel to http://localhost:3000/.");
    expect(tunnels.closeTunnel).toHaveBeenCalledWith("t1");
  });
});
