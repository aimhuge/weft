// electron/new-thread-link.cjs: the L-3 weft://new handler. The dialog is pre-filled but the
// user has to click Start, so a clickjacked link can't fire a thread.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNewThreadLink, resolveFolder } from "./new-thread-link.cjs";

describe("resolveFolder", () => {
  it("returns the explicit folder from the URL", async () => {
    const url = new URL("weft://new?folder=/Users/me/dev/app");
    const server = { url: "http://localhost" };
    expect(await resolveFolder(url, server)).toBe("/Users/me/dev/app");
  });

  it("falls back to the first project's path from /api/settings", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ projects: [{ path: "/Users/me/dev/proj" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const url = new URL("weft://new?prompt=hi");
    const server = { url: "http://localhost" };
    expect(await resolveFolder(url, server)).toBe("/Users/me/dev/proj");
    expect(fetchMock).toHaveBeenCalledWith("http://localhost/api/settings", { headers: { "x-weft-token": "1" } });
  });
});

describe("createNewThreadLink", () => {
  function makeFetch(overrides: { ok?: boolean; status?: number; statusText?: string; body?: unknown } = {}) {
    return vi.fn().mockResolvedValue({
      ok: overrides.ok ?? true,
      status: overrides.status ?? 200,
      statusText: overrides.statusText ?? "OK",
      json: () => Promise.resolve(overrides.body ?? { card: { id: "card-1" } }),
    });
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", makeFetch());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup() {
    // The handle only calls showMessageBox; the rest of Electron's dialog surface is fine to
    // leave out so the test stays focused.
    return {
      sendMenu: vi.fn(),
      dialog: { showMessageBox: vi.fn() } as unknown as Electron.Dialog,
      getServer: () => ({ url: "http://localhost" }),
      getWin: () => ({}),
    };
  }

  function parseBody<T>(init: RequestInit, hint: T): T {
    // Wraps JSON.parse so the caller can type the result; eslint flags inline `as T` on the
    // parse result as `any`-to-typed unsafe assignment.
    const raw = init.body as string;
    const parsed = JSON.parse(raw) as T;
    return { ...hint, ...parsed };
  }

  it("sends a Start button-required request (start: false) regardless of start=1", async () => {
    const { sendMenu, dialog, ...rest } = setup();
    const handle = createNewThreadLink({ ...rest, sendMenu, dialog });
    await handle(new URL("weft://new?prompt=hello&start=1&cli=puku"));
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    // The first call is /api/settings (folder resolution), the second is /api/cards.
    const cardsCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(cardsCall[0]).toBe("http://localhost/api/cards");
    const body = parseBody<{ start: boolean; backend: string; prompt: string }>(cardsCall[1], { start: false, backend: "claude", prompt: "" });
    expect(body.start).toBe(false);
    expect(body.backend).toBe("puku");
    expect(body.prompt).toBe("hello");
    expect(sendMenu).toHaveBeenCalledWith("open-card", "card-1");
  });

  it("defaults the backend to claude when cli isn't set", async () => {
    const { sendMenu, dialog, ...rest } = setup();
    const handle = createNewThreadLink({ ...rest, sendMenu, dialog });
    await handle(new URL("weft://new?prompt=hi"));
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const secondCall = fetchMock.mock.calls[1] as [string, RequestInit] | undefined;
    const body = parseBody<{ backend: string }>(secondCall![1], { backend: "puku" });
    expect(body.backend).toBe("claude");
  });

  it("without a prompt, opens the New Thread dialog and skips fetch", async () => {
    const { sendMenu, dialog, ...rest } = setup();
    const handle = createNewThreadLink({ ...rest, sendMenu, dialog });
    await handle(new URL("weft://new"));
    expect(sendMenu).toHaveBeenCalledWith("new-thread");
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a server error as a warning dialog (no throw)", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", makeFetch({ ok: false, status: 500, statusText: "Server Error", body: { error: "boom" } }));
    const { sendMenu, dialog, ...rest } = setup();
    // Pull the mock by string-keyed lookup so the unbound-method rule doesn't fire on
    // `dialog.showMessageBox` (a method reference). Same pattern as lib/auth/desktop.test.ts.
    const KEY = "showMessageBox" as const;
    const showMessageBox = (dialog as unknown as Record<typeof KEY, ReturnType<typeof vi.fn>>)[KEY];
    const handle = createNewThreadLink({ ...rest, sendMenu, dialog });
    await handle(new URL("weft://new?prompt=hi"));
    expect(showMessageBox).toHaveBeenCalled();
    expect(sendMenu).not.toHaveBeenCalled();
  });
});
