import { describe, expect, it, vi } from "vitest";
import { setupSlack } from "./slack.cjs";
import { API, fakeFetch, lastSocket, QuietSocket, resetSockets, safeStorage, sockets, tmp } from "./slack.harness";

// Electron main, wired up: Slack's messages go to the Weft server, and the board's IPC answers Slack.
describe("setupSlack", () => {
  // One fetch for both sides: Slack's calls go to the fake Slack, the server's go to the fake server.
  function bothFetches(serverAnswer: { status?: number } = {}) {
    const calls: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[] = [];
    const { fetch: slackFetch } = fakeFetch(API);
    const fetch = vi.fn(async (url: string | URL, init: { method: string; headers: Record<string, string>; body?: string }) => {
      const href = String(url);
      if (href.includes("/api/slack/inbound")) {
        calls.push({ url: href, init });
        const status = serverAnswer.status ?? 200;
        return { ok: status < 400, status, json: () => Promise.resolve({}) };
      }
      return slackFetch(href, init);
    });
    return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
  }

  // setupSlack's options: the timers it takes are the ones createSlack would use anyway, and the fake
  // websocket and fetch are the fakes.
  interface SetupOptions {
    ipcMain: { handle: (channel: string, listener: (...args: unknown[]) => void) => void };
    dataDir: string;
    board: () => unknown;
    server: () => { url: string; token: string } | null;
    safeStorage: typeof safeStorage;
    fetch?: typeof globalThis.fetch;
    WebSocketImpl: typeof WebSocket;
    setTimer: (fn: () => void, ms: number) => unknown;
    clearTimer: (handle: unknown) => void;
  }
  const options = (over: Partial<SetupOptions> = {}): SetupOptions => ({
    ipcMain: { handle: () => {} },
    dataDir: tmp("weft-data-"),
    board: () => ({}),
    server: () => ({ url: "http://127.0.0.1:1024", token: "launch" }),
    safeStorage,
    WebSocketImpl: QuietSocket as unknown as typeof WebSocket,
    setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimer: (handle: unknown) => clearTimeout(handle as NodeJS.Timeout),
    ...over,
  });

  it("forwards a Slack message to the server with the launch token", async () => {
    const { fetch, calls } = bothFetches();
    const slack = setupSlack(options({ fetch }));
    await slack.setTokens("xoxb-a", "xapp-a");
    await vi.waitFor(() => expect(sockets().length).toBeGreaterThan(0));
    lastSocket().onmessage?.({ data: JSON.stringify({ envelope_id: "e1", type: "slash_commands", payload: { command: "/weft", text: "go", channel_id: "C1", user_id: "U1" } }) });
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0]?.url).toBe("http://127.0.0.1:1024/api/slack/inbound");
    expect(calls[0]?.init.headers["x-weft-token"]).toBe("launch");
    expect(JSON.parse(calls[0]?.init.body ?? "{}")).toEqual({ kind: "command", text: "go", channel: "C1", user: "U1" });
  });

  it("says so, and drops the message, when there is no server to forward to", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      resetSockets();
      const { fetch, calls } = bothFetches();
      const slack = setupSlack(options({ fetch, server: () => null }));
      await slack.setTokens("xoxb-a", "xapp-a");
      await vi.waitFor(() => expect(sockets().length).toBeGreaterThan(0));
      lastSocket().onmessage?.({ data: JSON.stringify({ envelope_id: "e1", type: "slash_commands", payload: { command: "/weft", text: "go", channel_id: "C1", user_id: "U1" } }) });
      await vi.waitFor(() => expect(warn).toHaveBeenCalled());
      expect(warn.mock.calls[0]?.[0]).toContain("no Weft server");
      expect(calls).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps the socket alive when the server turns the message down", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      resetSockets();
      const { fetch } = bothFetches({ status: 500 });
      const slack = setupSlack(options({ fetch }));
      await slack.setTokens("xoxb-a", "xapp-a");
      await vi.waitFor(() => expect(sockets().length).toBeGreaterThan(0));
      lastSocket().onmessage?.({ data: JSON.stringify({ envelope_id: "e1", type: "slash_commands", payload: { command: "/weft", text: "go", channel_id: "C1", user_id: "U1" } }) });
      await vi.waitFor(() => expect(warn).toHaveBeenCalled());
      expect(warn.mock.calls[0]?.[0]).toContain("couldn't deliver");
    } finally {
      warn.mockRestore();
    }
  });
});
