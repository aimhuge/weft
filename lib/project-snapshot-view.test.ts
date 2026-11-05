// @vitest-environment jsdom
// A worker project's snapshot on the board (lib/project-snapshot-view.ts): one request shared by the badges for a few
// seconds, a badge's read from it, the age line only when it's stale or the worker is offline, and the hook.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SnapshotView } from "./project-snapshot-view";

const fetchMock = vi.hoisted(() => vi.fn<(url: string) => Promise<Response>>());
vi.mock("./api-client", () => ({ apiFetch: (url: string) => fetchMock(url) }));
const heard = vi.hoisted(() => ({ fn: null as ((event: unknown) => void) | null, open: null as (() => void) | null }));
vi.mock("./use-events", () => ({
  useBoardEvents: (fn: (event: unknown) => void, open: () => void) => {
    heard.fn = fn;
    heard.open = open;
  },
}));

const { SNAPSHOT_TTL_MS, STALE_MS, cloudRead, fetchSnapshot, forgetSnapshots, snapshotAge, snapshotChanged, snapshotVersion, useSnapshotVersion, useSnapshotView, useWorkerProjectEvents } =
  await import("./project-snapshot-view");

const NOW = Date.parse("2026-11-02T12:00:00.000Z");
const pile = { root: "/w/ling", files: 1, added: 2, removed: 0, cards: 0 };
const view = (over: Partial<SnapshotView> = {}): SnapshotView => ({
  snapshot: { at: NOW, quality: null, scout: null, pile, backlog: null },
  updatedAt: new Date(NOW).toISOString(),
  worker: "m1mini",
  status: "online",
  ...over,
});
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.clearAllMocks();
  forgetSnapshots();
});

describe("fetchSnapshot", () => {
  it("shares one request for a few seconds, then asks again", async () => {
    fetchMock.mockImplementation(() => json(view()));
    await fetchSnapshot("worker://w1/ling", NOW);
    await fetchSnapshot("worker://w1/ling", NOW + 1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/worker-board?project=worker%3A%2F%2Fw1%2Fling");
    await fetchSnapshot("worker://w1/ling", NOW + SNAPSHOT_TTL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forgets a failed read, saying why", async () => {
    fetchMock.mockImplementationOnce(() => json({ error: "Sign in to Weft to reach your worker." }, 502));
    await expect(fetchSnapshot("worker://w1/ling", NOW)).rejects.toThrow("Sign in to Weft");
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response("<html>", { status: 500 })));
    await expect(fetchSnapshot("worker://w1/ling", NOW)).rejects.toThrow("HTTP 500");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("cloudRead", () => {
  it("is a badge's read from the snapshot, null when the worker hasn't measured it", async () => {
    fetchMock.mockImplementation(() => json(view()));
    await expect(cloudRead("pile", "worker://w1/ling")).resolves.toEqual(pile);
    await expect(cloudRead("quality", "worker://w1/ling")).resolves.toBeNull();
    forgetSnapshots();
    fetchMock.mockImplementation(() => json(view({ snapshot: null, updatedAt: null })));
    await expect(cloudRead("pile", "worker://w1/ling")).resolves.toBeNull();
  });
});

describe("snapshotAge", () => {
  it("says nothing while it's fresh and the worker is up", () => {
    expect(snapshotAge(null, NOW)).toBeNull();
    expect(snapshotAge(view(), NOW + STALE_MS)).toBeNull();
  });

  it("gives the age when it's stale, and names an offline worker", () => {
    expect(snapshotAge(view(), NOW + STALE_MS + 60_000)).toBe("21m ago");
    expect(snapshotAge(view({ status: "offline" }), NOW + 12 * 60_000)).toBe("12m ago, m1mini offline");
  });

  it("says when the worker has never published one", () => {
    expect(snapshotAge(view({ updatedAt: null }), NOW)).toBe("No reads from m1mini yet");
    expect(snapshotAge(view({ updatedAt: null, status: "offline" }), NOW)).toBe("No reads from m1mini yet, m1mini offline");
  });
});

describe("useSnapshotView", () => {
  it("reads the project's snapshot, and nothing without a project", async () => {
    fetchMock.mockImplementation(() => json(view()));
    const initialProps: { project: string | null } = { project: "worker://w1/ling" };
    const { result, rerender } = renderHook(({ project }: { project: string | null }) => useSnapshotView(project), { initialProps });
    await waitFor(() => expect(result.current?.worker).toBe("m1mini"));
    rerender({ project: null });
    expect(result.current).toBeNull();
  });

  it("keeps nothing from a read that failed, or one that lands after it unmounted", async () => {
    fetchMock.mockImplementationOnce(() => json({ error: "nope" }, 502));
    const { result } = renderHook(() => useSnapshotView("worker://w1/a"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBeNull();
    let release: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const late = renderHook(() => useSnapshotView("worker://w1/b"));
    late.unmount();
    release(new Response(JSON.stringify(view())));
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("a worker's new snapshot", () => {
  it("drops that project's cached view and moves its version, leaving the others alone", async () => {
    fetchMock.mockImplementation(() => json(view()));
    await fetchSnapshot("worker://w1/ling", NOW);
    await fetchSnapshot("worker://w1/other", NOW);
    const before = snapshotVersion("worker://w1/ling");
    snapshotChanged("worker://w1/ling");
    expect(snapshotVersion("worker://w1/ling")).toBe(before + 1);
    expect(snapshotVersion(null)).toBe(0);
    await fetchSnapshot("worker://w1/ling", NOW + 1_000);
    await fetchSnapshot("worker://w1/other", NOW + 1_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("is heard off the board's events, and a badge's version follows it", () => {
    renderHook(() => useWorkerProjectEvents());
    const { result } = renderHook(() => useSnapshotVersion("worker://w2/app"));
    expect(result.current).toBe(0);
    act(() => heard.fn?.({ type: "crons" }));
    expect(result.current).toBe(0);
    act(() => heard.fn?.({ type: "worker_project", project: "worker://w2/app" }));
    expect(result.current).toBe(1);
    heard.open?.();
    const { result: none, unmount } = renderHook(() => useSnapshotVersion(undefined));
    expect(none.current).toBe(0);
    unmount();
  });
});
