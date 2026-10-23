import { afterEach, describe, expect, it, vi } from "vitest";
import { API_HEADERS, API_TOKEN_HEADER, apiFetch } from "./api-client";

// The one place that knows the board's fetch header. lib/guard.ts refuses every route — reads included —
// once the desktop app has written a launch token, so a fetch that forgets the header 403s and the call
// site's .catch() swallows it into an empty default: a whole UI feature disappears with no error shown.

/** A fetch mock that records the url and the init, so a test can read the headers. */
type FetchMock = ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

afterEach(() => {
  vi.unstubAllGlobals();
});

// The headers of the fetch that was called, as a plain object.
function headersOf(fetchMock: FetchMock, call = 0): Record<string, string> {
  const entry = fetchMock.mock.calls[call];
  if (!entry) throw new Error("fetch was not called");
  const init = entry[1];
  const headers = init?.headers;
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  return (headers ?? {}) as Record<string, string>;
}

describe("apiFetch", () => {
  it("sends the token header lib/guard.ts checks", async () => {
    const fetchMock: FetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/pile?cwd=%2Fdev%2Fapp");
    expect(headersOf(fetchMock)).toMatchObject({ [API_TOKEN_HEADER]: "1" });
  });

  it("passes the url and the rest of the init through", async () => {
    const fetchMock: FetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/cards/c1/thread", { method: "GET", cache: "no-store" });
    const entry = fetchMock.mock.calls[0];
    if (!entry) throw new Error("fetch was not called");
    const init = entry[1];
    expect(entry[0]).toBe("/api/cards/c1/thread");
    expect(init?.method).toBe("GET");
    expect(init?.cache).toBe("no-store");
    expect(headersOf(fetchMock)).toMatchObject({ [API_TOKEN_HEADER]: "1" });
  });

  it("keeps a content-type the call site sets", async () => {
    const fetchMock: FetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/welcome", { method: "POST", headers: { "content-type": "application/json" } });
    expect(headersOf(fetchMock)).toMatchObject({ [API_TOKEN_HEADER]: "1", "content-type": "application/json" });
  });

  it("lets a call site set the token itself, and keeps one header of its own", async () => {
    const fetchMock: FetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/cards/c1/thread", { headers: { "x-weft-token": "other", "x-extra": "1" } });
    expect(headersOf(fetchMock)).toMatchObject({ "x-weft-token": "other", "x-extra": "1" });
  });

  it("works with no init at all", async () => {
    const fetchMock: FetchMock = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/game");
    expect(headersOf(fetchMock)).toMatchObject({ [API_TOKEN_HEADER]: "1" });
  });
});

describe("API_HEADERS", () => {
  it("is the token header on its own, ready to spread into a call site's own headers", () => {
    expect(API_HEADERS).toEqual({ "x-weft-token": "1" });
    expect(API_HEADERS[API_TOKEN_HEADER]).toBe("1");
  });
});
