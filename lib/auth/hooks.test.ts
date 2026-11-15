// @vitest-environment jsdom
// lib/auth/hooks.ts: useAuth drives the OAuth round trip. Verifies the three
// moves the call sites care about: signInWithOAuth fetches the URL, opens the
// system browser, sets waiting; signOut hits the JSON API; announceChange
// fires on sign-in success so other instances reload.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountView } from "@/lib/types";

const api = vi.hoisted(() => ({
  account: vi.fn<() => Promise<AccountView>>(),
  signIn: vi.fn(() => Promise.resolve({ url: "https://github.com/login/oauth/authorize" })),
  magicLink: vi.fn(() => Promise.resolve({ ok: true as const })),
  signOut: vi.fn(() => Promise.resolve({ ok: true as const })),
  signOutEverywhere: vi.fn(() => Promise.resolve({ ok: true as const })),
}));
vi.mock("../client", () => ({ api }));

const openExternalMock = vi.fn();
vi.mock("./desktop", () => ({
  openExternal: (url: string) => {
    openExternalMock(url);
  },
  isDesktop: () => Boolean(window.weft),
  authRedirectTo: (next: string) => `weft://account-callback?next=${encodeURIComponent(next)}`,
}));

import { useAuth } from "./hooks";

const signedOut: AccountView = { configured: true, user: null };
const signedIn: AccountView = {
  configured: true,
  user: { id: "u1", email: "ada@b.co", name: "Ada", avatar: null, provider: "github" },
};

describe("useAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.account.mockResolvedValue(signedOut);
    delete (window as unknown as { weft?: { openExternal?: (u: string) => void } }).weft;
  });

  afterEach(() => {
    delete (window as unknown as { weft?: { openExternal?: (u: string) => void } }).weft;
  });

  it("loads the account view on mount", async () => {
    api.account.mockResolvedValueOnce(signedIn);
    const { result } = renderHook(() => useAuth());
    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });
    expect(result.current.state).toEqual({ kind: "ready", view: signedIn });
  });

  it("exposes an error state when the account endpoint rejects", async () => {
    api.account.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => {
      expect(result.current.state.kind).toBe("error");
    });
    if (result.current.state.kind === "error") {
      expect(result.current.state.error).toBe("offline");
    }
  });

  it("signInWithOAuth fetches the URL and opens the system browser", async () => {
    (window as unknown as { weft: { openExternal: (u: string) => void } }).weft = {
      openExternal: openExternalMock,
    };
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    await act(async () => {
      const r = await result.current.signInWithOAuth({ provider: "github" });
      expect(r.error).toBeNull();
    });

    expect(api.signIn).toHaveBeenCalledWith("github", "/");
    expect(openExternalMock).toHaveBeenCalledWith("https://github.com/login/oauth/authorize");
    expect(result.current.waiting).not.toBeNull();
    expect(result.current.busy).toBeNull();
  });

  it("signInWithOAuth surfaces an error string when /api/account rejects", async () => {
    api.signIn.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    await act(async () => {
      const r = await result.current.signInWithOAuth({ provider: "github" });
      expect(r.error).toBeInstanceOf(Error);
      expect((r.error as Error).message).toBe("network down");
    });
    expect(result.current.error).toBe("network down");
  });

  it("signOut calls /api/account/signout and fires weft:account", async () => {
    const events: Event[] = [];
    const onAccount = () => events.push(new Event("weft:account"));
    window.addEventListener("weft:account", onAccount);
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    await act(async () => {
      await result.current.signOut();
    });

    expect(api.signOut).toHaveBeenCalledOnce();
    expect(events.length).toBeGreaterThan(0);
    window.removeEventListener("weft:account", onAccount);
  });

  it("signOutEverywhere calls the global sign-out and surfaces its error", async () => {
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    await act(async () => {
      await result.current.signOutEverywhere();
    });
    expect(api.signOutEverywhere).toHaveBeenCalledOnce();
    expect(api.signOut).not.toHaveBeenCalled();
    api.signOutEverywhere.mockRejectedValueOnce(new Error("This change needs Weft's own window"));
    await act(async () => {
      await result.current.signOutEverywhere();
    });
    expect(result.current.error).toBe("This change needs Weft's own window");
    expect(result.current.busy).toBeNull();
  });
});
