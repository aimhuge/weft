// @vitest-environment jsdom
// The open card's host and what its workspace reads from it (lib/use-project-host.ts): on this Mac the board's own
// thread and pane, on a worker what its thread view drew and the page the card or the rail put on show.
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";

const local = vi.hoisted(() => ({ kind: "local", can: () => true }));
const cloud = vi.hoisted(() => ({ kind: "cloud", can: () => false }));
vi.mock("./project-host", () => ({ hostFor: (cwd: string) => (cwd.startsWith("worker://") ? cloud : local) }));

const { useProjectHost } = await import("./use-project-host");
const { useShownItems } = await import("./worker-shown");

const item = (text: string): ThreadItem => ({ kind: "user", text, at: 0 });
const card = (over: Partial<Card> = {}) => ({ id: "c1", title: "Fix it", cwd: "worker://w1/ling", ...over }) as Card;

afterEach(() => vi.clearAllMocks());

describe("useProjectHost", () => {
  it("on this Mac, is the board's own thread and the native pane's page", () => {
    const items = [item("one")];
    const { result } = renderHook(() => useProjectHost(card({ cwd: "/r" }), { items, pageUrl: "http://localhost:3000" }));
    expect(result.current.host).toBe(local);
    expect(result.current.items).toBe(items);
    expect(result.current.page).toEqual({ url: "http://localhost:3000" });
  });

  it("on a worker, reads what the thread view drew and starts on the card's page", () => {
    const drawn = [item("from the worker")];
    renderHook(() => useShownItems(drawn));
    const { result } = renderHook(() => useProjectHost(card({ page: "blob:sha256:aa" }), { items: [item("local")], pageUrl: "http://x" }));
    expect(result.current.host).toBe(cloud);
    expect(result.current.items).toBe(drawn);
    expect(result.current.page.url).toBe("blob:sha256:aa");
    expect(result.current.page.shots).toEqual({});
  });

  it("puts the pane on the page the rail picked, until the card opens another", () => {
    const { result, rerender } = renderHook(({ c }) => useProjectHost(c, { items: [], pageUrl: "" }), { initialProps: { c: card({ page: "blob:sha256:aa" }) } });
    const bb = `blob:sha256:${"b".repeat(64)}`;
    act(() => result.current.page.open?.(bb));
    expect(result.current.page.url).toBe(bb);
    rerender({ c: card({ page: "blob:sha256:cc" }) });
    expect(result.current.page.url).toBe("blob:sha256:cc");
  });

  it("puts a tour step's worker path on the blob the card opened it as, and leaves a page only the worker has", () => {
    const ref = `blob:sha256:${"b".repeat(64)}`;
    const opened: ThreadItem = { kind: "tool", id: "t1", name: "mcp__browser__open_url", summary: ref, result: "Opened /home/me/show/todos.html — Todos.", at: 1 };
    renderHook(() => useShownItems([opened]));
    const { result } = renderHook(() => useProjectHost(card({ page: "blob:sha256:aa" }), { items: [], pageUrl: "" }));
    act(() => result.current.page.open?.("/home/me/show/other.html"));
    expect(result.current.page.url).toBe("blob:sha256:aa");
    act(() => result.current.page.open?.("http://localhost:3000/"));
    expect(result.current.page.url).toBe("blob:sha256:aa");
    act(() => result.current.page.open?.("/home/me/show/todos.html"));
    expect(result.current.page.url).toBe(ref);
  });

  it("has no page for a worker card that never opened one", () => {
    const { result } = renderHook(() => useProjectHost(card(), { items: [], pageUrl: "" }));
    expect(result.current.page.url).toBe("");
  });

  it("pictures the card's page with its last capture, when that's a picture the board can load", () => {
    const https = renderHook(() => useProjectHost(card({ page: "blob:sha256:aa", thumb: "https://cdn/x.png" }), { items: [], pageUrl: "" }));
    expect(https.result.current.page.shots).toEqual({ "blob:sha256:aa": "https://cdn/x.png" });
    const blob = renderHook(() => useProjectHost(card({ page: "blob:sha256:aa", thumb: "blob:sha256:th" }), { items: [], pageUrl: "" }));
    expect(blob.result.current.page.shots).toEqual({});
  });

  it("empties the rail when the card closes", () => {
    renderHook(() => useShownItems([item("old")]));
    const open = renderHook(() => useProjectHost(card(), { items: [], pageUrl: "" }));
    open.unmount();
    const next = renderHook(() => useProjectHost(card({ id: "c2" }), { items: [], pageUrl: "" }));
    expect(next.result.current.items).toEqual([]);
  });

  it("keeps the same pictures while the page and its capture stay put", () => {
    const at = (c: Card) => ({ c });
    const { result, rerender } = renderHook(({ c }) => useProjectHost(c, { items: [], pageUrl: "" }), { initialProps: at(card({ page: "blob:sha256:aa", thumb: "https://cdn/x.png" })) });
    const first = result.current.page.shots;
    rerender(at(card({ page: "blob:sha256:aa", thumb: "https://cdn/x.png", title: "polled again" })));
    expect(result.current.page.shots).toBe(first);
  });
});
