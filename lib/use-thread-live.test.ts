// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadTransport } from "./thread-transport";
import { useThreadLive } from "./use-thread-live";

afterEach(cleanup);

describe("useThreadLive", () => {
  it("shows the board's streaming text, or else what the transport streams", () => {
    let stream: ((text: string) => void) | undefined;
    const transport = { useLive: vi.fn((_c: string, _u: unknown, _r: unknown, on?: (text: string) => void) => void (stream = on)) } as unknown as ThreadTransport;
    const { result, rerender } = renderHook(({ given }) => useThreadLive(transport, "c1", vi.fn(), vi.fn(), given), { initialProps: { given: "" } });
    expect(result.current).toBe("");
    act(() => stream?.("from the line"));
    expect(result.current).toBe("from the line");
    rerender({ given: "from the board" });
    expect(result.current).toBe("from the board");
  });
});
