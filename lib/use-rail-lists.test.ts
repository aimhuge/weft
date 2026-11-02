// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const useWebhooks = vi.hoisted(() => vi.fn<(...args: unknown[]) => { hooks: never[] }>(() => ({ hooks: [] })));
vi.mock("./use-webhooks", () => ({ useWebhooks }));
const all = vi.hoisted(() => ({ crons: [{ id: "worker:w1:k1", cwd: "worker://w1/app" }, { id: "k2", cwd: "/dev/app" }], update: vi.fn() }));
vi.mock("./use-crons", () => ({ useCrons: () => all }));

const { useRailLists } = await import("./use-rail-lists");

describe("useRailLists", () => {
  it("is every cron and the board's folders' webhooks on this Mac's projects", () => {
    const { result } = renderHook(() => useRailLists(undefined, ["/dev/app"], true));
    expect(useWebhooks).toHaveBeenLastCalledWith(["/dev/app"], true);
    expect(result.current.crons).toBe(all);
    expect([result.current.hookFolders, result.current.hookProject]).toEqual([["/dev/app"], null]);
  });

  it("is that worker's own on a worker project", () => {
    const { result } = renderHook(() => useRailLists("worker://w1/app", ["/dev/app"], false));
    expect(useWebhooks).toHaveBeenLastCalledWith(["worker://w1/app"], false);
    expect(result.current.crons.crons.map((c) => c.id)).toEqual(["worker:w1:k1"]);
    expect(result.current.crons.update).toBe(all.update);
    expect(result.current.hookProject).toBe("worker://w1/app");
  });
});
