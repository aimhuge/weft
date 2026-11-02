// @vitest-environment jsdom
// Which way each worker is reached (lib/worker-route.ts): the relay's round trip, and the direct line H6 reports.
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DIRECT_FRESH_MS, getWorkerRoute, noteRelay, resetWorkerRoute, routeLabel, setWorkerRoute, useWorkerRoutes } from "./worker-route";

afterEach(resetWorkerRoute);

describe("routeLabel", () => {
  it("says the way and the round trip", () => {
    expect(routeLabel({ via: "relay", ms: 600 })).toBe("relay · 600 ms");
    expect(routeLabel({ via: "direct", ms: 4 })).toBe("direct · 4 ms");
  });

  it("says nothing before the first round trip", () => {
    expect(routeLabel(null)).toBeNull();
    expect(routeLabel(undefined)).toBeNull();
  });
});

describe("noteRelay and setWorkerRoute", () => {
  it("notes a relay round trip, rounded", () => {
    noteRelay("w1", 612.4, 1000);
    expect(getWorkerRoute("w1")).toEqual({ via: "relay", ms: 612, at: 1000 });
  });

  it("keeps each worker's own route", () => {
    noteRelay("w1", 600, 1000);
    setWorkerRoute("w2", "direct", 4, 1000);
    expect(getWorkerRoute("w1")?.via).toBe("relay");
    expect(getWorkerRoute("w2")?.via).toBe("direct");
    expect(getWorkerRoute("w3")).toBeNull();
  });

  it("lets a direct note win over relay reads while it is fresh, for that worker only", () => {
    setWorkerRoute("w1", "direct", 4, 1000);
    noteRelay("w1", 600, 1000 + DIRECT_FRESH_MS - 1);
    noteRelay("w2", 700, 1000 + DIRECT_FRESH_MS - 1);
    expect(getWorkerRoute("w1")?.via).toBe("direct");
    expect(getWorkerRoute("w2")?.via).toBe("relay");
  });

  it("goes back to relay once the direct note is stale", () => {
    setWorkerRoute("w1", "direct", 4, 1000);
    noteRelay("w1", 600, 1000 + DIRECT_FRESH_MS);
    expect(getWorkerRoute("w1")).toMatchObject({ via: "relay", ms: 600 });
  });

  it("never goes below zero", () => {
    setWorkerRoute("w1", "direct", -3);
    expect(getWorkerRoute("w1")?.ms).toBe(0);
  });
});

describe("useWorkerRoutes", () => {
  it("redraws when a route changes and stops listening on unmount", () => {
    const { result, unmount } = renderHook(() => useWorkerRoutes());
    expect(result.current.size).toBe(0);
    act(() => noteRelay("w1", 50));
    expect(routeLabel(result.current.get("w1"))).toBe("relay · 50 ms");
    unmount();
    act(() => noteRelay("w1", 60));
    expect(getWorkerRoute("w1")?.ms).toBe(60);
  });
});
