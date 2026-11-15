// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { startModesOf, useStartModes } from "./web-start-modes";

describe("startModesOf", () => {
  it("keeps each device's valid published mode", () => {
    expect(
      startModesOf([
        { device: "mac-1", capabilities: { startMode: "default" } },
        { device: "mac-2", capabilities: { startMode: "bypassPermissions" } },
        { device: "mac-3", capabilities: {} },
        { device: null, capabilities: { startMode: "auto" } },
        { device: "mac-4", capabilities: null },
      ]),
    ).toEqual({ "mac-1": "default" });
  });
});

function client(result: Promise<{ data: unknown }>) {
  const builder = { select: () => builder, eq: vi.fn(() => builder), then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => result.then(ok, bad) };
  return { from: vi.fn(() => builder) } as unknown as SupabaseClient;
}

describe("useStartModes", () => {
  it("reads the workspace's desktop rows", async () => {
    const { result } = renderHook(() => useStartModes(client(Promise.resolve({ data: [{ device: "mac-1", capabilities: { startMode: "acceptEdits" } }] })), "o1"));
    await waitFor(() => expect(result.current).toEqual({ "mac-1": "acceptEdits" }));
  });

  it("stays empty when the read fails or answers nothing", async () => {
    const failed = renderHook(() => useStartModes(client(Promise.reject(new Error("offline"))), "o1"));
    const none = renderHook(() => useStartModes(client(Promise.resolve({ data: null })), "o1"));
    await new Promise((r) => setTimeout(r, 0));
    expect(failed.result.current).toEqual({});
    expect(none.result.current).toEqual({});
  });

  it("drops a read that lands after it's gone", async () => {
    let land: (v: { data: unknown }) => void = () => {};
    const { result, unmount } = renderHook(() => useStartModes(client(new Promise((r) => (land = r))), "o1"));
    unmount();
    land({ data: [{ device: "mac-1", capabilities: { startMode: "auto" } }] });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toEqual({});
  });
});
