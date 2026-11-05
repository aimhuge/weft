import { beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_MS, clearRemoteCache, remoteNotes, reportRemote, toSiteNote, uploadRemote, type RemoteDeps } from "./site-notes-remote";
import type { ServedVersion } from "./site-notes-status";

// The desktop's side of shared site notes: a bearer token, a fetch and a per-host cache.

const served = (over: Partial<ServedVersion> = {}): ServedVersion => ({
  noteId: "n1",
  host: "example.com",
  path: "/p",
  scope: "public",
  versionId: "v1",
  body: "body",
  confirmations: 2,
  stale: false,
  candidate: false,
  ...over,
});

type FetchMock = ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;
type TokenMock = ReturnType<typeof vi.fn<() => Promise<string | null>>>;

// A fetch that answers with one JSON body, and a token that names the user.
const jsonFetch = (body: unknown, status = 200): FetchMock => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

// The port's fetch is the global one, so a mock stands in for it with a cast the mock's own type allows.
const asFetch = (mock: FetchMock): typeof fetch => mock as unknown as typeof fetch;

type Deps = { deps: RemoteDeps; fetchMock: FetchMock; tokenMock: TokenMock };

function deps(over: Partial<RemoteDeps> = {}, fetchMock?: FetchMock, tokenMock?: TokenMock): Deps {
  const fetch = fetchMock ?? jsonFetch({ ok: true, value: [] });
  const token = tokenMock ?? vi.fn<() => Promise<string | null>>(() => Promise.resolve("tok"));
  const d: RemoteDeps = {
    token,
    fetchFn: asFetch(fetch),
    env: {},
    ...over,
  };
  return { deps: d, fetchMock: fetch, tokenMock: token };
}

beforeEach(() => {
  clearRemoteCache();
  vi.clearAllMocks();
});

describe("toSiteNote", () => {
  it("carries the served version across as a local note", () => {
    expect(toSiteNote(served())).toEqual({
      host: "example.com",
      path: "/p",
      body: "body",
      updated: "",
      source: "public",
      versionId: "v1",
      confirmations: 2,
    });
  });

  it("marks a candidate, a stale note and a confirmed one", () => {
    expect(toSiteNote(served({ candidate: true, stale: true, lastSuccess: "2026-01-02" }))).toEqual({
      host: "example.com",
      path: "/p",
      body: "body",
      updated: "",
      source: "public",
      versionId: "v1",
      confirmations: 2,
      candidate: true,
      stale: true,
      lastSuccess: "2026-01-02",
    });
  });
});

describe("remoteNotes", () => {
  it("asks for the host's notes and maps them", async () => {
    const { deps: d, fetchMock } = deps({}, jsonFetch({ ok: true, value: [served()] }));
    expect(await remoteNotes("example.com", false, d)).toEqual([
      { host: "example.com", path: "/p", body: "body", updated: "", source: "public", versionId: "v1", confirmations: 2 },
    ]);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://weft.zip/api/site-notes/cloud?host=example.com");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("asks for the contributor's view when the user shares notes", async () => {
    const { deps: d, fetchMock } = deps();
    await remoteNotes("example.com", true, d);
    expect((fetchMock.mock.calls[0] ?? [])[0]).toBe("https://weft.zip/api/site-notes/cloud?host=example.com&contributor=1");
  });

  it("uses the deployment's own address when there is one", async () => {
    const { deps: d, fetchMock } = deps({ env: { WEFT_TEAMS_URL: "https://teams.example.com///" } });
    await remoteNotes("example.com", false, d);
    expect((fetchMock.mock.calls[0] ?? [])[0]).toBe("https://teams.example.com/api/site-notes/cloud?host=example.com");
  });

  it("caches the notes per host and doesn't ask again", async () => {
    const { deps: d, fetchMock } = deps({}, jsonFetch({ ok: true, value: [served()] }));
    await remoteNotes("example.com", false, d, 1000);
    await remoteNotes("example.com", false, d, 1000 + CACHE_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks again once the cache is older than the window", async () => {
    const { deps: d, fetchMock } = deps();
    await remoteNotes("example.com", false, d, 1000);
    await remoteNotes("example.com", false, d, 1000 + CACHE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the notes of one host out of another's cache", async () => {
    const { deps: d, fetchMock } = deps();
    await remoteNotes("a.example.com", false, d);
    await remoteNotes("b.example.com", false, d);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("is empty when signed out", async () => {
    const { deps: d, fetchMock } = deps({}, undefined, vi.fn<() => Promise<string | null>>(() => Promise.resolve(null)));
    expect(await remoteNotes("example.com", false, d)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is empty when the fetch throws", async () => {
    const throwing = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.reject(new Error("offline")));
    const { deps: d } = deps({}, throwing);
    expect(await remoteNotes("example.com", false, d)).toEqual([]);
  });

  it("is empty on a non-200 reply", async () => {
    const { deps: d } = deps({}, jsonFetch({ error: "nope" }, 500));
    expect(await remoteNotes("example.com", false, d)).toEqual([]);
  });

  it("is empty when the reply has no value", async () => {
    const { deps: d } = deps({}, jsonFetch({ ok: true }));
    expect(await remoteNotes("example.com", false, d)).toEqual([]);
  });

  it("caches a failed read, so an offline Mac doesn't wait on every open_url", async () => {
    const throwing = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.reject(new Error("offline")));
    const { deps: d, fetchMock } = deps({}, throwing);
    await remoteNotes("example.com", false, d, 1000);
    await remoteNotes("example.com", false, d, 1000 + 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("uploadRemote", () => {
  it("posts the note and reports the version it made", async () => {
    const { deps: d, fetchMock } = deps({}, jsonFetch({ ok: true, value: { versionId: "v9" } }));
    expect(await uploadRemote({ host: "example.com", path: "/p", body: "b", scope: "team" }, d)).toEqual({ ok: true, versionId: "v9" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://weft.zip/api/site-notes/cloud");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({ action: "upload", host: "example.com", path: "/p", body: "b", scope: "team" });
  });

  it("drops the host's cached notes, so the next read sees the upload", async () => {
    const { deps: d, fetchMock } = deps({}, jsonFetch({ ok: true, value: { versionId: "v9" } }));
    await remoteNotes("example.com", false, d, 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await uploadRemote({ host: "example.com", path: "/p", body: "b", scope: "team" }, d);
    await remoteNotes("example.com", false, d, 1001);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports the reason the server gave", async () => {
    const { deps: d } = deps({}, jsonFetch({ error: "bad-key" }, 400));
    expect(await uploadRemote({ host: "example.com", path: "/p", body: "b", scope: "team" }, d)).toEqual({ ok: false, error: "bad-key" });
  });

  it("carries the safety findings back", async () => {
    const findings = [{ rule: "orders", message: "Gives the card orders" }];
    const { deps: d } = deps({}, jsonFetch({ error: "rejected", findings }, 422));
    expect(await uploadRemote({ host: "example.com", path: "/p", body: "b", scope: "team" }, d)).toEqual({ ok: false, error: "rejected", findings });
  });

  it("says signed-out when there is no token", async () => {
    const { deps: d } = deps({}, undefined, vi.fn<() => Promise<string | null>>(() => Promise.resolve(null)));
    expect(await uploadRemote({ host: "example.com", path: "/p", body: "b", scope: "team" }, d)).toEqual({ ok: false, error: "signed-out" });
  });

  it("says offline when the fetch throws", async () => {
    const throwing = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.reject(new Error("offline")));
    const { deps: d } = deps({}, throwing);
    expect(await uploadRemote({ host: "example.com", path: "/p", body: "b", scope: "team" }, d)).toEqual({ ok: false, error: "offline" });
  });

  it("says offline when the reply names no error", async () => {
    const { deps: d } = deps({}, jsonFetch({}, 500));
    expect(await uploadRemote({ host: "example.com", path: "/p", body: "b", scope: "team" }, d)).toEqual({ ok: false, error: "offline" });
  });
});

describe("reportRemote", () => {
  it("posts the outcome and reports that it landed", async () => {
    const { deps: d, fetchMock } = deps({}, jsonFetch({ ok: true, value: null }));
    expect(await reportRemote({ versionId: "v1", outcome: "success" }, d)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://weft.zip/api/site-notes/cloud");
    expect(JSON.parse(init?.body as string)).toEqual({ action: "report", versionId: "v1", outcome: "success" });
  });

  it("is false when the server refuses", async () => {
    const { deps: d } = deps({}, jsonFetch({ error: "no-version" }, 404));
    expect(await reportRemote({ versionId: "v1", outcome: "failure" }, d)).toBe(false);
  });

  it("is false when signed out", async () => {
    const { deps: d } = deps({}, undefined, vi.fn<() => Promise<string | null>>(() => Promise.resolve(null)));
    expect(await reportRemote({ versionId: "v1", outcome: "failure" }, d)).toBe(false);
  });

  it("is false when the fetch throws", async () => {
    const throwing = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.reject(new Error("offline")));
    const { deps: d } = deps({}, throwing);
    expect(await reportRemote({ versionId: "v1", outcome: "failure" }, d)).toBe(false);
  });
});
