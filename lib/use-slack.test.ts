// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlackChannel, SlackSettings, SlackStatus } from "./slack-types";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("./api-client", () => ({ apiFetch }));

const { useSlack } = await import("./use-slack");

const STATUS: SlackStatus = { signedIn: true, team: "Acme", teamUrl: null, bot: "Weft", socket: "connected", error: null };
const CHANNELS: SlackChannel[] = [
  { id: "C1", name: "eng", isPrivate: false, isMember: true },
  { id: "C2", name: "secret", isPrivate: true, isMember: false },
];
const SETTINGS: SlackSettings = { channel: "C1", channelName: "eng", folder: "/dev/app", links: [], events: { commits: true, pushes: false, deploys: true, status: false, growth: true }, routes: {} };

function answer(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body), status: ok ? 200 : 500, statusText: "Server Error" };
}

// The mock answers per URL: the settings live at /api/slack, the test message at /api/slack/test and the
// folder's sync at /api/cloud-sync. `overrides` replaces one of them for a single test.
const routes: Record<string, () => unknown> = {
  "/api/slack": () => answer({ settings: SETTINGS, folderSynced: false }),
  "/api/slack/test": () => answer({ ok: true, text: "sent" }),
  "/api/cloud-sync": () => answer({ settings: SETTINGS, folderSynced: true }),
};

function override(url: string, body: unknown, ok = false) {
  routes[url] = () => answer(body, ok);
}

function bridge() {
  return {
    status: vi.fn(() => Promise.resolve(STATUS)),
    setTokens: vi.fn(() => Promise.resolve(STATUS)),
    forgetToken: vi.fn(() => Promise.resolve({ ...STATUS, signedIn: false })),
    channels: vi.fn(() => Promise.resolve(CHANNELS)),
    createChannel: vi.fn((name: string) => Promise.resolve({ id: "C9", name, isPrivate: false, isMember: true })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  routes["/api/slack"] = () => answer({ settings: SETTINGS, folderSynced: false });
  routes["/api/slack/test"] = () => answer({ ok: true, text: "sent" });
  routes["/api/cloud-sync"] = () => answer({ settings: SETTINGS, folderSynced: true });
  apiFetch.mockImplementation((url: string) => Promise.resolve(routes[url]?.() ?? answer({}, false)));
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("useSlack", () => {
  it("loads the status and the settings while it is open", async () => {
    const slack = bridge();
    (window as unknown as { weft: unknown }).weft = { slack };
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.status).toEqual(STATUS));
    expect(result.current.settings).toEqual(SETTINGS);
    expect(result.current.folderSynced).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(apiFetch).toHaveBeenCalledWith("/api/slack");
    expect(slack.status).toHaveBeenCalled();
  });

  it("does nothing while it is closed", () => {
    const slack = bridge();
    (window as unknown as { weft: unknown }).weft = { slack };
    const { result } = renderHook(() => useSlack(false));
    expect(result.current.status).toBeNull();
    expect(slack.status).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("reads the projects that sync", async () => {
    override("/api/slack", { settings: SETTINGS, folderSynced: false, synced: ["/dev/app", "/dev/mapped"] }, true);
    const slack = bridge();
    (window as unknown as { weft: unknown }).weft = { slack };
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.synced).toEqual(["/dev/app", "/dev/mapped"]));
  });

  it("has no synced projects when the answer names none", async () => {
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    expect(result.current.synced).toEqual([]);
  });

  it("reloads when the window comes back into focus", async () => {
    const slack = bridge();
    (window as unknown as { weft: unknown }).weft = { slack };
    renderHook(() => useSlack(true));
    await waitFor(() => expect(slack.status).toHaveBeenCalledTimes(1));
    await act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(slack.status).toHaveBeenCalledTimes(2));
  });

  it("says so, with no status, in a browser tab", async () => {
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.note).toMatch(/desktop app/));
    expect(result.current.status).toBeNull();
  });

  it("reports what went wrong when the settings can't be read", async () => {
    override("/api/slack", { error: "No workspace" });
    const slack = bridge();
    (window as unknown as { weft: unknown }).weft = { slack };
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.error).toBe("No workspace"));
  });

  it("falls back to a plain message when the failure has no words", async () => {
    routes["/api/slack"] = () => ({ ok: false, json: async () => Promise.reject(new Error("no json")), status: 500, statusText: "Server Error" });
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.error).toBe("Slack's settings couldn't be read."));
  });

  it("connects the tokens and reloads", async () => {
    const slack = bridge();
    (window as unknown as { weft: unknown }).weft = { slack };
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.status).toEqual(STATUS));
    await act(() => result.current.connect("xoxb-1", "xapp-1"));
    expect(slack.setTokens).toHaveBeenCalledWith("xoxb-1", "xapp-1");
    await waitFor(() => expect(slack.status).toHaveBeenCalledTimes(2));
  });

  it("disconnects and reloads", async () => {
    const slack = bridge();
    (window as unknown as { weft: unknown }).weft = { slack };
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.status).toEqual(STATUS));
    await act(() => result.current.disconnect());
    expect(slack.forgetToken).toHaveBeenCalled();
  });

  it("loads the channels and keeps them", async () => {
    const slack = bridge();
    (window as unknown as { weft: unknown }).weft = { slack };
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.status).toEqual(STATUS));
    await act(() => result.current.loadChannels());
    expect(result.current.channels).toEqual(CHANNELS);
  });

  it("keeps why the channels couldn't be listed, and clears it once they can", async () => {
    const slack = bridge();
    slack.channels.mockRejectedValueOnce(new Error("missing channels:read"));
    (window as unknown as { weft: unknown }).weft = { slack };
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.status).toEqual(STATUS));
    await act(() => result.current.loadChannels());
    expect(result.current.channelsError).toBe("missing channels:read");
    await act(() => result.current.loadChannels());
    expect(result.current.channelsError).toBeNull();
    expect(result.current.channels).toEqual(CHANNELS);
  });

  it("keeps a failure that isn't an Error as text", async () => {
    const slack = bridge();
    slack.channels.mockRejectedValueOnce("offline");
    (window as unknown as { weft: unknown }).weft = { slack };
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.status).toEqual(STATUS));
    await act(() => result.current.loadChannels());
    expect(result.current.channelsError).toBe("offline");
  });

  it("puts a new channel at the top of the list and hands it back", async () => {
    const slack = bridge();
    (window as unknown as { weft: unknown }).weft = { slack };
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.status).toEqual(STATUS));
    await act(() => result.current.loadChannels());
    const made = await act(() => result.current.createChannel("weft-updates"));
    expect(made).toEqual({ id: "C9", name: "weft-updates", isPrivate: false, isMember: true });
    expect(slack.createChannel).toHaveBeenCalledWith("weft-updates");
    expect(result.current.channels[0]).toEqual(made);
    expect(result.current.channels).toHaveLength(3);
  });

  it("replaces the channel it made if the list already had one with that id", async () => {
    const slack = bridge();
    slack.channels.mockResolvedValue([...CHANNELS, { id: "C9", name: "old-name", isPrivate: false, isMember: true }]);
    (window as unknown as { weft: unknown }).weft = { slack };
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.status).toEqual(STATUS));
    await act(() => result.current.loadChannels());
    expect(result.current.channels).toHaveLength(3);
    await act(() => result.current.createChannel("weft-updates"));
    expect(result.current.channels).toHaveLength(3);
    expect(result.current.channels[0]?.name).toBe("weft-updates");
    expect(result.current.channels.filter((c) => c.id === "C9")).toHaveLength(1);
  });

  it("says so when there is no Slack side to make a channel in", async () => {
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.note).toMatch(/desktop app/));
    await expect(result.current.createChannel("weft-updates")).rejects.toThrow("desktop app");
  });

  it("asks for a restart when the shell's bridge predates making channels", async () => {
    const old: Partial<ReturnType<typeof bridge>> = bridge();
    delete old.createChannel;
    (window as unknown as { weft: unknown }).weft = { slack: old };
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.status).toEqual(STATUS));
    await expect(result.current.createChannel("weft-updates")).rejects.toThrow("Restart Weft");
  });

  it("saves a patch and applies the server's answer", async () => {
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    override("/api/slack", { settings: { ...SETTINGS, channel: "C2", channelName: "secret" }, folderSynced: true }, true);
    await act(() => result.current.save({ channel: "C2", channelName: "secret" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/slack", expect.objectContaining({ method: "PUT" }));
    const init = apiFetch.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "PUT")?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ channel: "C2", channelName: "secret" });
    expect(result.current.settings?.channel).toBe("C2");
    expect(result.current.folderSynced).toBe(true);
  });

  it("takes the synced projects the save answers with", async () => {
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    override("/api/slack", { settings: SETTINGS, folderSynced: true, synced: ["/dev/mapped"] }, true);
    await act(() => result.current.save({ links: [{ folder: "/dev/mapped", channel: "C7", channelName: "mapped" }] }));
    expect(result.current.synced).toEqual(["/dev/mapped"]);
  });

  it("says so when a patch can't be saved", async () => {
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    override("/api/slack", { error: "nope" });
    await expect(result.current.save({ folder: "/x" })).rejects.toThrow("nope");
  });

  it("shows the patch at once, before the server answers", async () => {
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    // The save hangs until the test lets it answer.
    let reply: (v: unknown) => void = () => undefined;
    apiFetch.mockImplementationOnce(() => new Promise((resolve) => (reply = resolve)));
    act(() => {
      void result.current.save({ channel: "C2", channelName: "secret", events: { pushes: true } });
    });
    // The patch is in the settings while the call is still waiting.
    expect(result.current.settings?.channel).toBe("C2");
    expect(result.current.settings?.channelName).toBe("secret");
    expect(result.current.settings?.events.pushes).toBe(true);
    // The rest of the events are kept.
    expect(result.current.settings?.events.commits).toBe(true);
    await act(async () => {
      reply(answer({ settings: { ...SETTINGS, channel: "C2", channelName: "secret" } }));
      await Promise.resolve();
    });
    expect(result.current.settings?.channel).toBe("C2");
  });

  it("puts the old settings back when the save can't be made", async () => {
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    // The save hangs until the test refuses it, so the patch is on screen first.
    let refuse: (e: Error) => void = () => undefined;
    apiFetch.mockImplementationOnce(() => new Promise((_, reject) => (refuse = reject)));
    // The rejection is caught right away, so it never lands on its own.
    const failed = result.current.save({ channel: "C2" }).catch((err: unknown) => err);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.settings?.channel).toBe("C2");
    await act(async () => {
      refuse(new Error("offline"));
      await Promise.resolve();
    });
    expect(await failed).toBeInstanceOf(Error);
    // The refused patch is gone and the old settings are back.
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
  });

  it("puts the old settings back when the server refuses the save", async () => {
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    // The save hangs until the test answers with a refusal.
    let refuse: (v: unknown) => void = () => undefined;
    apiFetch.mockImplementationOnce(() => new Promise((resolve) => (refuse = resolve)));
    // The refusal is caught right away, so it never lands on its own.
    const failed = result.current.save({ channel: "C2" }).catch((err: unknown) => err);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.settings?.channel).toBe("C2");
    await act(async () => {
      refuse(answer({ error: "nope" }, false));
      await Promise.resolve();
    });
    expect(await failed).toBeInstanceOf(Error);
    // The refused patch is gone and the old settings are back.
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
  });

  it("sends a test message", async () => {
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    await act(() => result.current.test());
    expect(apiFetch).toHaveBeenCalledWith("/api/slack/test", expect.objectContaining({ method: "POST" }));
  });

  it("says so when the test message can't be sent", async () => {
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    override("/api/slack/test", { error: "no channel" });
    await expect(result.current.test()).rejects.toThrow("no channel");
  });

  it("turns a folder's sync on and reloads", async () => {
    const slack = bridge();
    (window as unknown as { weft: unknown }).weft = { slack };
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    // Once the folder is on, the settings answer says so.
    override("/api/slack", { settings: SETTINGS, folderSynced: true }, true);
    await act(() => result.current.syncFolder("/dev/app"));
    const call = apiFetch.mock.calls.find((c) => c[0] === "/api/cloud-sync");
    expect(call).toBeTruthy();
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({ folder: "/dev/app", on: true });
    expect(result.current.folderSynced).toBe(true);
  });

  it("says so when the folder's sync can't be turned on", async () => {
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    override("/api/cloud-sync", { error: "no folder" });
    await expect(result.current.syncFolder("/dev/app")).rejects.toThrow("no folder");
  });
});
