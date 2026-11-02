// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetLimitSamples, readLimitSamples, useLimitSamples } from "./use-limit-samples";

// One read per CLI and worker a minute, shared by every strip and chart; a worker's is its own published history.
const SAMPLE = { at: 1, backend: "claude", kind: "five_hour", used: 5 };

function serve(ok = true) {
  const fetchMock = vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve({ samples: [SAMPLE] }) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  forgetLimitSamples();
  vi.unstubAllGlobals();
});

describe("readLimitSamples", () => {
  it("asks for the CLI's history, or a worker's, and reuses a read for a minute", async () => {
    const fetchMock = serve();
    expect(await readLimitSamples("claude", undefined, 0)).toEqual([SAMPLE]);
    await readLimitSamples("claude", undefined, 59_999);
    await readLimitSamples("claude", "w 1", 0);
    await readLimitSamples("claude", undefined, 60_000);
    expect(fetchMock.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["/api/limits?backend=claude", "/api/limits?backend=claude&worker=w%201", "/api/limits?backend=claude"]);
  });

  it("reads an answer with no samples as none", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
    expect(await readLimitSamples("goose")).toEqual([]);
  });

  it("reads a refusal or a failure as no history", async () => {
    serve(false);
    expect(await readLimitSamples("puku")).toEqual([]);
    forgetLimitSamples();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("down"))));
    expect(await readLimitSamples("puku")).toEqual([]);
  });
});

describe("useLimitSamples", () => {
  it("loads the samples, and reads nothing when told to skip", async () => {
    const fetchMock = serve();
    const { result } = renderHook(() => useLimitSamples("claude", "w1"));
    await waitFor(() => expect(result.current).toEqual([SAMPLE]));
    const skipped = renderHook(() => useLimitSamples("puku", undefined, true));
    expect(skipped.result.current).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("drops a read that lands after it unmounted", async () => {
    serve();
    const { unmount } = renderHook(() => useLimitSamples("codex"));
    unmount();
    await Promise.resolve();
  });
});
