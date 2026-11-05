// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn<(url: string) => Promise<Response>>());
vi.mock("./api-client", () => ({ apiFetch: (url: string) => fetchMock(url) }));
const poll = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock("./worker-poll", () => ({ startThreadPoll: (args: unknown) => (poll.start(args), poll.stop) }));
vi.mock("./worker-blob-view", () => ({ useWorkerView: "worker view" }));

import { loadTeamPage, READ_ONLY, teamHostOf, teamPlace, teamToolSource, teamTransport } from "./team-host";

const ORG = "org-x";
const page = { items: [], start: 0, total: 3 };
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  fetchMock.mockReset();
  poll.start.mockReset();
  poll.stop.mockReset();
});

describe("loadTeamPage", () => {
  it("reads a page of the card's thread in its team's workspace", async () => {
    fetchMock.mockReturnValue(json(page));
    expect(await loadTeamPage(ORG, "c1", 10, 4)).toEqual(page);
    expect(fetchMock).toHaveBeenCalledWith("/api/team-board?org=org-x&card=c1&before=10&after=4");
    await loadTeamPage(ORG, "c1");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/team-board?org=org-x&card=c1");
  });

  it("is null when the read fails or the server can't be reached", async () => {
    fetchMock.mockReturnValue(json({ error: "x" }, 502));
    expect(await loadTeamPage(ORG, "c1")).toBeNull();
    fetchMock.mockRejectedValue(new Error("down"));
    expect(await loadTeamPage(ORG, "c1")).toBeNull();
  });
});

describe("teamToolSource", () => {
  it("reads a cut tool output, or refuses", async () => {
    fetchMock.mockReturnValue(json({ result: "all" }));
    expect(await teamToolSource(ORG)("c1", "t1")).toBe("all");
    expect(fetchMock).toHaveBeenCalledWith("/api/team-board?org=org-x&card=c1&tool=t1");
    fetchMock.mockReturnValue(json({}, 404));
    await expect(teamToolSource(ORG)("c1", "t1")).rejects.toThrow("404");
  });
});

describe("teamTransport", () => {
  it("pages and polls through the team route, and never stops the card", async () => {
    const t = teamTransport(ORG);
    expect(t.desktop).toBe(false);
    expect(t).toMatchObject({ useView: "worker view" });
    expect(t.cardEdits).toBeUndefined();
    expect(t.shell).toBeUndefined();
    fetchMock.mockReturnValue(json(page));
    expect(await t.loadPage("c1", 5)).toEqual(page);
    await expect(t.stop("c1")).rejects.toThrow(READ_ONLY);
  });

  it("polls the open thread and lays each page over the last", async () => {
    const onUpdate = vi.fn();
    const { unmount, rerender } = renderHook(({ cb }) => teamTransport(ORG).useLive("c1", cb, () => {}), { initialProps: { cb: onUpdate } });
    expect(poll.start).toHaveBeenCalledOnce();
    const { cardId, fetchPage, apply } = poll.start.mock.calls[0]![0] as { cardId: string; fetchPage: (after?: number) => Promise<unknown>; apply: (p: unknown) => void };
    expect(cardId).toBe("c1");
    fetchMock.mockReturnValue(json(page));
    await fetchPage(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/team-board?org=org-x&card=c1&after=2");
    const later = vi.fn();
    rerender({ cb: later });
    apply(page);
    expect(later).toHaveBeenCalledOnce();
    const merge = later.mock.calls[0]![0] as (prev: unknown) => unknown;
    expect(merge({ items: [], start: 0, total: 0 })).toBeDefined();
    expect(onUpdate).not.toHaveBeenCalled();
    unmount();
    expect(poll.stop).toHaveBeenCalledOnce();
  });
});

describe("teamHostOf", () => {
  it("is one read-only host per team workspace", async () => {
    const host = teamHostOf({ org: ORG });
    expect(teamHostOf({ org: ORG })).toBe(host);
    expect(teamHostOf({ org: "other" })).not.toBe(host);
    expect(host.kind).toBe("cloud");
    for (const feature of ["files", "pane", "share", "delete", "schedule", "terminal"] as const) expect(host.can(feature)).toBe(false);
    await expect(host.act("card.stop", { id: "c1" })).rejects.toThrow(READ_ONLY);
    await expect(host.read("quality", "/r")).resolves.toBeNull();
    await expect(host.files.read("c1", "a.ts")).rejects.toThrow(READ_ONLY);
    expect(host.files.live).toBe(false);
    host.warm("c1");
  });

  it("keeps only Open in the card's menu", () => {
    const items = [{ id: "open", label: "Open" }, { separator: true }, { id: "stop", label: "Stop" }, { id: "archive", label: "Archive" }];
    expect(teamHostOf({ org: ORG }).menu(items as never)).toEqual([{ id: "open", label: "Open" }]);
  });
});

describe("teamPlace", () => {
  it("names the teammate's Mac", () => {
    expect(teamPlace({ org: ORG, owner: "z", name: "Zulker Nayeen", device: "d" })).toBe("Zulker's Mac");
  });
});
