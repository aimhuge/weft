// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_PROMPT_KEY } from "./phone-prompt";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("./api-client", () => ({ apiFetch }));

type AccountStub = { kind: "ready"; view: { user: { id: string } | null } } | { kind: "loading" };
const account = vi.hoisted(() => ({ state: null as unknown as AccountStub }));
vi.mock("./use-account", () => ({ useAccount: () => ({ state: account.state }) }));

const sync = vi.hoisted(() => ({ asked: false }));
vi.mock("./use-sync-prompt", () => ({ syncAskedThisLaunch: () => sync.asked }));

const welcome = vi.hoisted(() => ({ loadWelcome: vi.fn() }));
vi.mock("./welcome-client", () => welcome);

const { inviteMe, loadTestflight, resetOfferedForTests, useTestflightLink, usePhonePrompt } = await import("./use-testflight");

const INFO = { url: "https://testflight.apple.com/join/abc", invites: true };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// Routes the three endpoints the prompt reads.
function serve({ testflight = json(INFO), devices = json({ devices: [] }) }: { testflight?: Response | Error; devices?: Response | Error } = {}) {
  apiFetch.mockImplementation((url: string) => {
    const r = url === "/api/account/testflight" ? testflight : url === "/api/push-devices" ? devices : new Error(`unexpected ${url}`);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r.clone());
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetOfferedForTests();
  localStorage.clear();
  sync.asked = false;
  account.state = { kind: "ready", view: { user: { id: "u1" } } };
  welcome.loadWelcome.mockResolvedValue({ welcome: true });
  serve();
});

describe("loadTestflight", () => {
  it("reads the local route", async () => {
    expect(await loadTestflight()).toEqual(INFO);
    expect(apiFetch).toHaveBeenCalledWith("/api/account/testflight");
  });

  it("is null on a non-ok answer or a failed fetch", async () => {
    serve({ testflight: json({}, 403) });
    expect(await loadTestflight()).toBeNull();
    serve({ testflight: new Error("down") });
    expect(await loadTestflight()).toBeNull();
  });
});

describe("inviteMe", () => {
  it("POSTs and returns the answer", async () => {
    serve({ testflight: json({ ok: true, email: "a@b.co", already: false }) });
    expect(await inviteMe()).toEqual({ ok: true, email: "a@b.co", already: false });
    expect(apiFetch).toHaveBeenCalledWith("/api/account/testflight", { method: "POST" });
  });

  it("turns a thrown Error or a thrown string into an error answer", async () => {
    serve({ testflight: new Error("offline") });
    expect(await inviteMe()).toEqual({ ok: false, error: "offline" });
    apiFetch.mockRejectedValueOnce("plain");
    expect(await inviteMe()).toEqual({ ok: false, error: "plain" });
  });
});

describe("useTestflightLink", () => {
  it("is null while loading, then the link", async () => {
    const { result } = renderHook(() => useTestflightLink());
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(INFO.url));
  });

  it("stays null when there is no link", async () => {
    serve({ testflight: json({ url: null, invites: false }) });
    const { result } = renderHook(() => useTestflightLink());
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current).toBeNull();
  });

  it("stays null when the route fails", async () => {
    serve({ testflight: json({}, 500) });
    const { result } = renderHook(() => useTestflightLink());
    await act(async () => {});
    expect(result.current).toBeNull();
  });

  it("ignores an answer that lands after unmount", async () => {
    let release!: (r: Response) => void;
    apiFetch.mockReturnValueOnce(new Promise<Response>((res) => (release = res)));
    const { result, unmount } = renderHook(() => useTestflightLink());
    unmount();
    release(json(INFO));
    await act(async () => {});
    expect(result.current).toBeNull();
  });
});

describe("usePhonePrompt", () => {
  it("opens with the link and invites once everything lines up", async () => {
    const { result } = renderHook(() => usePhonePrompt(3));
    await waitFor(() => expect(result.current.url).toBe(INFO.url));
    expect(result.current.invites).toBe(true);
  });

  it("closing marks it seen for good and hides it", async () => {
    const { result } = renderHook(() => usePhonePrompt(3));
    await waitFor(() => expect(result.current.url).not.toBeNull());
    act(() => result.current.close());
    expect(result.current.url).toBeNull();
    expect(result.current.invites).toBe(false);
    expect(localStorage.getItem(PHONE_PROMPT_KEY)).toBe("1");
  });

  it("asks once a launch: a remount doesn't open it again", async () => {
    const first = renderHook(() => usePhonePrompt(3));
    await waitFor(() => expect(first.result.current.url).not.toBeNull());
    first.unmount();
    localStorage.clear();
    apiFetch.mockClear();
    const second = renderHook(() => usePhonePrompt(3));
    await act(async () => {});
    expect(second.result.current.url).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("fetches nothing until the cheap local checks pass", async () => {
    const cases: Array<() => void> = [
      () => (account.state = { kind: "loading" }),
      () => (account.state = { kind: "ready", view: { user: null } }),
      () => localStorage.setItem(PHONE_PROMPT_KEY, "1"),
      () => (sync.asked = true),
    ];
    for (const arrange of cases) {
      beforeEachReset();
      arrange();
      const { result, unmount } = renderHook(() => usePhonePrompt(5));
      await act(async () => {});
      expect(result.current.url).toBeNull();
      expect(apiFetch).not.toHaveBeenCalled();
      unmount();
    }
    // Too few finished threads.
    beforeEachReset();
    const { result } = renderHook(() => usePhonePrompt(2));
    await act(async () => {});
    expect(result.current.url).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  function beforeEachReset() {
    vi.clearAllMocks();
    localStorage.clear();
    sync.asked = false;
    account.state = { kind: "ready", view: { user: { id: "u1" } } };
    serve();
  }

  it("stays closed when not welcomed yet", async () => {
    welcome.loadWelcome.mockResolvedValue({ welcome: false });
    const { result } = renderHook(() => usePhonePrompt(3));
    await waitFor(() => expect(welcome.loadWelcome).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.url).toBeNull();
  });

  it("stays closed when a phone is already signed in", async () => {
    serve({ devices: json({ devices: [{ id: "p1" }] }) });
    const { result } = renderHook(() => usePhonePrompt(3));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/push-devices"));
    await act(async () => {});
    expect(result.current.url).toBeNull();
  });

  it("stays closed when the phone count is unknown (route fails, no devices field, fetch throws)", async () => {
    for (const devices of [json({}, 500), json({}), new Error("down")]) {
      resetOfferedForTests();
      serve({ devices });
      const { result, unmount } = renderHook(() => usePhonePrompt(3));
      await act(async () => {});
      expect(result.current.url).toBeNull();
      unmount();
    }
  });

  it("stays closed when weft.zip has no link", async () => {
    serve({ testflight: json({ url: null, invites: false }) });
    const { result } = renderHook(() => usePhonePrompt(3));
    await act(async () => {});
    expect(result.current.url).toBeNull();
  });

  it("swallows a failing welcome read", async () => {
    welcome.loadWelcome.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => usePhonePrompt(3));
    await act(async () => {});
    expect(result.current.url).toBeNull();
  });

  it("rechecks the flags after the fetches: closed elsewhere meanwhile means no dialog", async () => {
    welcome.loadWelcome.mockImplementation(() => {
      localStorage.setItem(PHONE_PROMPT_KEY, "1");
      return Promise.resolve({ welcome: true });
    });
    const { result } = renderHook(() => usePhonePrompt(3));
    await act(async () => {});
    expect(result.current.url).toBeNull();
  });

  it("rechecks the sync ask after the fetches", async () => {
    welcome.loadWelcome.mockImplementation(() => {
      sync.asked = true;
      return Promise.resolve({ welcome: true });
    });
    const { result } = renderHook(() => usePhonePrompt(3));
    await act(async () => {});
    expect(result.current.url).toBeNull();
  });

  it("drops the answer when unmounted before it lands", async () => {
    let release!: (v: { welcome: boolean }) => void;
    welcome.loadWelcome.mockReturnValue(new Promise((res) => (release = res)));
    const { result, unmount } = renderHook(() => usePhonePrompt(3));
    unmount();
    release({ welcome: true });
    await act(async () => {});
    expect(result.current.url).toBeNull();
  });

  it("drops the answer when another instance already offered it this launch", async () => {
    let release!: (v: { welcome: boolean }) => void;
    welcome.loadWelcome.mockReturnValueOnce(new Promise((res) => (release = res)));
    const slow = renderHook(() => usePhonePrompt(3));
    const fast = renderHook(() => usePhonePrompt(4));
    await waitFor(() => expect(fast.result.current.url).not.toBeNull());
    release({ welcome: true });
    await act(async () => {});
    expect(slow.result.current.url).toBeNull();
  });
});
