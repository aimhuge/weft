// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answer, override, routes, SETTINGS } from "./use-slack.harness";

// The Slack drawer's writes (lib/use-slack.ts): a patch of the settings, the test message and the folder's
// sync. The loading half lives in lib/use-slack.test.ts.

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

describe("saving the Slack settings", () => {
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

  it("keeps the kinds of update that go to a channel of their own", async () => {
    const routed = { ...SETTINGS, routes: { growth: { channel: "C9", channelName: "growth" } } };
    override("/api/slack", { settings: routed, folderSynced: false }, true);
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings?.routes.growth).toEqual({ channel: "C9", channelName: "growth" }));
    await act(() => result.current.save({ channel: "C2" }));
    expect(result.current.settings?.routes.growth).toEqual({ channel: "C9", channelName: "growth" });
  });

  it("drops a kind of update whose channel is cleared", async () => {
    const routed = { ...SETTINGS, routes: { growth: { channel: "C9", channelName: "growth" }, pushes: { channel: "C8", channelName: "pushes" } } };
    override("/api/slack", { settings: routed, folderSynced: false }, true);
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings?.routes.growth).toEqual({ channel: "C9", channelName: "growth" }));
    // The server answers with the route gone, the way the real route does.
    const cleared = { settings: { ...routed, routes: { pushes: routed.routes.pushes } }, folderSynced: false };
    routes["/api/slack"] = () => answer(cleared, true);
    await act(() => result.current.save({ routes: { growth: null } }));
    // The cleared kind is gone; the other one stays.
    expect(result.current.settings?.routes.growth).toBeUndefined();
    expect(result.current.settings?.routes.pushes).toEqual({ channel: "C8", channelName: "pushes" });
  });

  it("adds a kind of update that has a channel of its own", async () => {
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    // The server answers with the new route, the way the real route does.
    routes["/api/slack"] = () => answer({ settings: { ...SETTINGS, routes: { growth: { channel: "C9", channelName: "growth" } } }, folderSynced: false }, true);
    await act(() => result.current.save({ routes: { growth: { channel: "C9", channelName: "growth" } } }));
    expect(result.current.settings?.routes.growth).toEqual({ channel: "C9", channelName: "growth" });
  });

  it("saves a patch even when the settings have not arrived yet", async () => {
    // The drawer can save before the first load finishes; there is nothing to merge with yet.
    const { result } = renderHook(() => useSlack(true));
    await act(() => result.current.save({ channel: "C2" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/slack", expect.objectContaining({ method: "PUT" }));
  });

  it("says so when a patch can't be saved", async () => {
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    override("/api/slack", { error: "nope" });
    await expect(result.current.save({ folder: "/x" })).rejects.toThrow("nope");
  });

  it("says a plain thing when a refusal carries no words", async () => {
    const { result } = renderHook(() => useSlack(true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    // A refusal with an answer that names no reason.
    override("/api/slack", {}, false);
    await expect(result.current.save({ folder: "/x" })).rejects.toThrow("Slack's settings couldn't be saved.");
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
});

describe("the drawer's other buttons", () => {
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
