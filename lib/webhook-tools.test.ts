import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<Result>;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: (options: { name: string; alwaysLoad?: boolean; tools: Array<{ name: string; handler: Handler }> }) => options,
  tool: (name: string, _description: string, _schema: unknown, handler: Handler) => ({ name, handler }),
}));
vi.mock("./webhook-forward", () => ({ createRelay: vi.fn() }));

// The registry is real, in a temp dir; only the desktop shell (fetch) and the relay are faked.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-webhook-tools-"));
process.env.WEFT_DATA = dir;
vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:4567");
vi.mock("./shell-token", () => ({ shellToken: () => "tok" }));
const wt = await import("./webhook-tools");
const registry = await import("./webhooks");
const { createRelay } = await import("./webhook-forward");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const reply = (data: Record<string, unknown>, ok = true) => fetchMock.mockResolvedValueOnce({ ok, statusText: "Bad", json: () => Promise.resolve(data) });
const sent = (n = 0) => {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
  return { url, body: JSON.parse(init.body as string) as Record<string, unknown> };
};

const server = wt.webhooksMcpServer(() => "/proj") as unknown as { name: string; alwaysLoad: boolean; tools: Array<{ name: string; handler: Handler }> };
const run = (name: string, args: Record<string, unknown> = {}) => server.tools.find((t) => t.name === name)!.handler(args);
const said = (r: Result) => r.content[0]?.text;

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(createRelay).mockReset();
  fs.rmSync(path.join(dir, "webhooks.json"), { force: true });
});

describe("webhooksMcpServer", () => {
  it("is the webhooks server, loaded up front, and its prompt names every tool and warns off tunnels", () => {
    expect(server.name).toBe("webhooks");
    expect(server.alwaysLoad).toBe(true);
    expect(server.tools.map((t) => t.name)).toEqual(["list", "add_blank", "ask_add", "relay", "tunnel", "close_tunnel", "mark_registered"]);
    for (const name of ["add_blank", "ask_add", "relay", "tunnel", "close_tunnel", "mark_registered"]) expect(wt.WEBHOOKS_PROMPT).toContain(`mcp__webhooks__${name}`);
    expect(wt.WEBHOOKS_PROMPT).toContain("ngrok");
  });

  it("lists nothing, then each webhook of the card's folder with its state", async () => {
    expect(said(await run("list"))).toContain("no webhooks yet");
    const a = registry.addWebhook({ folder: "/proj", name: "stripe", target: "/s", events: ["a", "b"], secret: "STRIPE_WEBHOOK_SECRET" }).hook;
    registry.addWebhook({ folder: "/proj", name: "github", target: "/g" });
    registry.addWebhook({ folder: "/other", name: "resend", target: "/r" });
    registry.setRelay(a.id, { relayId: "r1", url: "https://weft.zip/h/r1" });
    registry.recordDelivery(a.id, { at: 1, method: "POST", status: 200, ms: 4 });
    const lines = said(await run("list"))!.split("\n");
    expect(lines).toEqual([
      "Webhooks in this project:",
      "- github: target http://localhost:3000/g; blank, not registered yet; no relay",
      "- stripe: target http://localhost:3000/s; registered; events a, b; relay https://weft.zip/h/r1; secret STRIPE_WEBHOOK_SECRET; last delivery 200",
    ]);
    expect(said(await run("list", { project: "/other" }))).toContain("- resend:");
    registry.recordDelivery(a.id, { at: 2, method: "POST", status: 0, ms: 4, error: "down" });
    expect(said(await run("list"))).toContain("last delivery unreachable");
  });

  it("records a blank, and its secret as a vault blank (best effort)", async () => {
    reply({ added: true });
    const r = await run("add_blank", { name: "stripe", target: "/api/stripe/webhook", events: ["x"], hint: "Stripe dashboard", secret: "STRIPE_WEBHOOK_SECRET" });
    expect([r.isError, said(r)]).toEqual([
      false,
      "stripe is a blank on 🪝 now (http://localhost:3000/api/stripe/webhook); the user registers it with the provider when they're ready. Carry on with what doesn't need it. For a public URL that forwards to http://localhost:3000/api/stripe/webhook, call mcp__webhooks__relay.",
    ]);
    expect(sent()).toEqual({ url: "http://127.0.0.1:4567/secrets/add-blank", body: { folder: "/proj", names: ["STRIPE_WEBHOOK_SECRET"], environment: "development", hint: "Stripe dashboard" } });
    expect(registry.listWebhooks(["/proj"])[0]).toMatchObject({ name: "stripe", events: ["x"], secret: "STRIPE_WEBHOOK_SECRET" });

    // Again: updated, and a vault that can't be reached doesn't fail the tool.
    reply({ error: "no vault" }, false);
    expect(said(await run("add_blank", { name: "Stripe", target: "/api/v2", secret: "STRIPE_WEBHOOK_SECRET", project: "/proj" }))).toContain("stripe is updated on 🪝");

    fetchMock.mockReset();
    await run("add_blank", { name: "gh", target: "/g" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a bad target as an error", async () => {
    const r = await run("add_blank", { name: "x", target: "https://example.com/h" });
    expect([r.isError, said(r)]).toEqual([true, "A webhook's target is on this Mac (localhost), where the relay forwards it."]);
  });

  it("adds a webhook and opens the 🪝 drawer on it", async () => {
    reply({ ok: true });
    const r = await run("ask_add", { name: "stripe", target: "/s", project: "/other" });
    const id = registry.listWebhooks(["/other"])[0]?.id;
    expect(sent()).toEqual({ url: "http://127.0.0.1:4567/webhooks/ask-add", body: { folder: "/other", id } });
    expect([r.isError, said(r)]).toEqual([false, expect.stringContaining("Opened the 🪝 drawer on stripe")]);
  });

  it("tells the thread when the board can't open the drawer", async () => {
    reply({ error: "no board" }, false);
    const r = await run("ask_add", { name: "stripe", target: "/s" });
    expect([r.isError, said(r)]).toEqual([true, "no board"]);
    // It was still recorded.
    expect(registry.listWebhooks(["/proj"])).toHaveLength(1);
  });

  it("gives a webhook its public relay URL", async () => {
    const a = registry.addWebhook({ folder: "/proj", name: "stripe", target: "/s", hint: "Stripe dashboard" }).hook;
    vi.mocked(createRelay).mockResolvedValueOnce({ ...a, url: "https://weft.zip/h/r1" });
    const r = await run("relay", { name: "STRIPE" });
    expect(createRelay).toHaveBeenCalledWith(a.id);
    expect(said(r)).toBe(
      "stripe has a public URL: https://weft.zip/h/r1\nRegister it with the provider (Stripe dashboard). Deliveries forward to http://localhost:3000/s while Weft runs. Once it's registered, call mcp__webhooks__mark_registered.",
    );
    vi.mocked(createRelay).mockResolvedValueOnce({ ...a, hint: undefined, url: "https://weft.zip/h/r1" });
    expect(said(await run("relay", { name: "stripe" }))).toContain("Register it with the provider. Deliveries");
  });

  it("reports signed out, and a webhook that isn't there", async () => {
    registry.addWebhook({ folder: "/proj", name: "stripe", target: "/s" });
    vi.mocked(createRelay).mockRejectedValueOnce(new Error("Sign in to your Weft account first."));
    const out = await run("relay", { name: "stripe" });
    expect([out.isError, said(out)]).toEqual([true, "Sign in to your Weft account first."]);
    const none = await run("relay", { name: "paypal" });
    expect(none.isError).toBe(true);
    expect(said(none)).toContain("No webhook “paypal” in this project");
  });

  it("marks a webhook registered", async () => {
    registry.addWebhook({ folder: "/proj", name: "stripe", target: "/s" });
    const r = await run("mark_registered", { name: "stripe" });
    expect(said(r)).toBe("stripe is registered; 🪝 no longer counts it as a blank.");
    expect(registry.listWebhooks(["/proj"])[0]?.registered).toBe(true);
    expect((await run("mark_registered", { name: "nope" })).isError).toBe(true);
  });
});
