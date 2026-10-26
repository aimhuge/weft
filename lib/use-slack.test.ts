// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answer, bridge, CHANNELS, override, routes, SETTINGS, STATUS } from "./use-slack.harness";

// The Slack drawer's reading half (lib/use-slack.ts): the status main says, the settings the server decides,
// and the channels the picker offers. The writing half lives in lib/use-slack-save.test.ts.

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("./api-client", () => ({ apiFetch }));

const { useSlack } = await import("./use-slack");

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

  it("connects and disconnects with no Slack side to talk to", async () => {
    // A browser tab has no bridge: the calls still work, they just have nothing to answer.
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    await act(() => result.current.connect("xoxb-1", "xapp-1"));
    expect(result.current.status).toBeNull();
    await act(() => result.current.disconnect());
    expect(result.current.status).toBeNull();
  });

  it("has no channels to list with no Slack side to ask", async () => {
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    await act(() => result.current.loadChannels());
    expect(result.current.channels).toEqual([]);
    expect(result.current.channelsError).toBeNull();
  });

  it("drops an answer that lands after a newer one", async () => {
    // Two loads overlap; the first one to answer is the one that counts.
    const slack = bridge();
    (window as unknown as { weft: unknown }).weft = { slack };
    let release = () => {};
    slack.status.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(STATUS))));
    const { result } = renderHook(() => useSlack(true));
    // A second load starts and finishes first.
    await act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status).toEqual(STATUS));
    // The slow first one answers now: it is stale, so it changes nothing.
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(result.current.status).toEqual(STATUS);
    expect(result.current.error).toBeNull();
  });

  it("keeps a failure that isn't an Error as text", async () => {
    // A rejection that is not an Error: a fetch can refuse with anything, and the drawer still has to say
    // what happened. The rule wants Errors, which is why it is off on this line only.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    apiFetch.mockImplementation(() => Promise.reject({ toString: () => "offline" }));
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.error).toBe("offline"));
  });

  it("does not report a failure from an answer that landed too late", async () => {
    // The first load is slow and fails; a newer load has already succeeded, so the old failure is dropped.
    let release = () => {};
    apiFetch.mockImplementationOnce(() => new Promise((_, reject) => (release = () => reject(new Error("too late")))));
    const { result } = renderHook(() => useSlack(true));
    await act(() => result.current.refresh());
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("says a plain thing when a refusal carries no words", async () => {
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    // A refusal with an answer that names no reason.
    override("/api/slack", {}, false);
    await expect(result.current.save({ folder: "/x" })).rejects.toThrow("Slack's settings couldn't be saved.");
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
});
