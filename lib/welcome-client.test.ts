import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WelcomeProject } from "./welcome-preview";

// lib/welcome-client.ts: the board's side of /api/welcome. fetch is faked; the rest of the helpers
// (answerFor, defaultTicks) are pure and tested here without a server.

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
function fail(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json" } });
}

let fetchMock = vi.fn();

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const { answerFor, answerWelcome, changeWelcome, defaultTicks, loadWelcome, REPLAY_EVENT, replayWelcome, resetOnboarding } = await import("./welcome-client");

const project = (cwd: string, scratch = false): WelcomeProject => ({
  cwd,
  name: cwd.split("/").pop() || cwd,
  where: cwd,
  sessions: 1,
  last: 1,
  scratch,
});

describe("loadWelcome", () => {
  it("fetches /api/welcome and returns the parsed view", async () => {
    fetchMock.mockResolvedValueOnce(ok({ welcome: { at: 1, countHistory: true, fresh: false, skip: [] } }));
    const view = await loadWelcome();
    expect(view.welcome).toEqual({ at: 1, countHistory: true, fresh: false, skip: [] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/welcome");
  });

  it("adds ?replay=1 when called with true", async () => {
    fetchMock.mockResolvedValueOnce(ok({ welcome: null, preview: { projects: [], profile: {} as never, github: null } }));
    await loadWelcome(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/welcome?replay=1");
  });

  it("rejects with the server's error message when the request fails", async () => {
    fetchMock.mockResolvedValueOnce(fail(500, "boom"));
    await expect(loadWelcome()).rejects.toThrow("boom");
  });

  it("falls back to a generic error when the server returns no body", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(loadWelcome()).rejects.toThrow("Request failed (500).");
  });

  it("exports a replay event name", () => {
    expect(REPLAY_EVENT).toBe("weft:welcome-replay");
  });
});

describe("replayWelcome", () => {
  function stubBrowser() {
    const store = new Map([
      ["weft-tips-seen", '["review"]'],
      ["weft-intros-seen", '["secrets"]'],
    ]);
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
    const win = new EventTarget();
    const events: string[] = [];
    for (const name of ["weft:tips-changed", REPLAY_EVENT]) win.addEventListener(name, () => events.push(name));
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", win);
    return { store, events };
  }

  it("resetOnboarding clears the seen tips and intros and tells the board", () => {
    const { store, events } = stubBrowser();
    resetOnboarding();
    expect([...store.keys()]).toEqual([]);
    expect(events).toEqual(["weft:tips-changed"]);
  });

  it("replays the dialog and brings back every welcome after it", () => {
    const { store, events } = stubBrowser();
    replayWelcome();
    expect([...store.keys()]).toEqual([]);
    expect(events).toEqual(["weft:tips-changed", REPLAY_EVENT]);
  });
});

describe("answerWelcome", () => {
  it("POSTs the answer with the write header and returns the saved welcome", async () => {
    const saved = { at: 9, countHistory: true, fresh: false, skip: [] };
    fetchMock.mockResolvedValueOnce(ok({ welcome: saved }));
    const result = await answerWelcome({ countHistory: true, fresh: false, skip: [] });
    expect(result.welcome).toEqual(saved);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/welcome");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json", "x-weft-token": "1" },
      body: JSON.stringify({ countHistory: true, fresh: false, skip: [] }),
    });
  });

  it("rejects with the server's error", async () => {
    fetchMock.mockResolvedValueOnce(fail(400, "bad"));
    await expect(answerWelcome({ countHistory: true, fresh: false, skip: [] })).rejects.toThrow("bad");
  });
});

describe("changeWelcome", () => {
  it("PATCHes countHistory changes", async () => {
    fetchMock.mockResolvedValueOnce(ok({ welcome: { at: 1, countHistory: false, fresh: false, skip: [] } }));
    const result = await changeWelcome({ countHistory: false });
    expect(result.welcome).toEqual({ at: 1, countHistory: false, fresh: false, skip: [] });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(init).toMatchObject({ method: "PATCH" });
  });

  it("PATCHes importAll", async () => {
    fetchMock.mockResolvedValueOnce(ok({ welcome: null }));
    await changeWelcome({ importAll: true });
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ importAll: true });
  });

  it("rejects with the server's error", async () => {
    fetchMock.mockResolvedValueOnce(fail(403, "nope"));
    await expect(changeWelcome({ countHistory: false })).rejects.toThrow("nope");
  });
});

describe("answerFor", () => {
  it("lists every unticked project as a skip when not fresh", () => {
    const projects = [project("/a"), project("/b"), project("/c")];
    const ticked = new Set(["/a", "/c"]);
    expect(answerFor(true, projects, ticked, false)).toEqual({ countHistory: true, fresh: false, skip: ["/b"] });
  });

  it("clears the skip list when fresh is true", () => {
    const projects = [project("/a"), project("/b")];
    expect(answerFor(true, projects, new Set(), true)).toEqual({ countHistory: true, fresh: true, skip: [] });
  });

  it("preserves the countHistory flag verbatim", () => {
    const projects = [project("/a")];
    expect(answerFor(false, projects, new Set(["/a"]), false).countHistory).toBe(false);
  });
});

describe("defaultTicks", () => {
  it("ticks every non-scratch project", () => {
    const projects = [project("/a"), project("/b", true), project("/c")];
    const set = defaultTicks(projects);
    expect([...set]).toEqual(["/a", "/c"]);
  });

  it("returns an empty set when every project is a scratch folder", () => {
    expect(defaultTicks([project("/a", true), project("/b", true)])).toEqual(new Set());
  });

  it("returns an empty set when there are no projects at all", () => {
    expect(defaultTicks([])).toEqual(new Set());
  });
});
