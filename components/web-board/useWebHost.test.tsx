// @vitest-environment jsdom
// weft.zip holds a worker's session line while one of your worker cards is open (useWebLine), and only then.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { CloudCardRow } from "@/lib/cloud-sync-types";
import { closeLines, lineFor, type MakeLine } from "@/lib/session-lines";
import type { SessionLine } from "@/lib/session-line";
import { useWebLine } from "./useWebHost";

const fakeLine = (workerId: string) => ({ workerId, close: vi.fn(), onRoute: () => () => {}, onEvent: () => () => {}, route: () => ({ kind: "connecting" }) }) as unknown as SessionLine;
const row = (owner_device: string, owner_user = "u1") => ({ owner_device, owner_user }) as CloudCardRow;

afterEach(() => {
  closeLines();
  vi.unstubAllGlobals();
});

describe("useWebLine", () => {
  it("holds the worker's line for your own worker card, where the browser has WebRTC", () => {
    vi.stubGlobal("RTCPeerConnection", function RTCPeerConnection() {});
    const make = vi.fn<MakeLine>(fakeLine);
    const { result, rerender } = renderHook<string | undefined, { card?: CloudCardRow }>(({ card }) => useWebLine(make, card, "u1"), { initialProps: { card: row("worker:w-1") } });
    expect(result.current).toBe("w-1");
    expect(make).toHaveBeenCalledWith("w-1");
    expect(lineFor("w-1")).not.toBeNull();
    rerender({ card: row("mac-1") });
    expect(result.current).toBeUndefined();
    rerender({ card: row("worker:w-2", "teammate") });
    expect(result.current).toBeUndefined();
    rerender({});
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("holds none without WebRTC", () => {
    vi.stubGlobal("RTCPeerConnection", undefined);
    const make = vi.fn<MakeLine>(fakeLine);
    const { result } = renderHook(() => useWebLine(make, row("worker:w-1"), "u1"));
    expect(result.current).toBeUndefined();
    expect(make).not.toHaveBeenCalled();
  });
});
