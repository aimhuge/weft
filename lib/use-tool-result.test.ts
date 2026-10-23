// @vitest-environment happy-dom
import { cleanup, renderHook, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { ToolResultSourceContext, toolSizeLabel, useToolResult } from "./use-tool-result";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function details(): { current: HTMLDetailsElement } {
  const el = document.createElement("details");
  document.body.appendChild(el);
  return { current: el };
}

function open(ref: { current: HTMLDetailsElement }) {
  act(() => {
    ref.current.open = true;
    ref.current.dispatchEvent(new Event("toggle"));
  });
}

describe("toolSizeLabel", () => {
  it("reads bytes, kilobytes and megabytes the way a file manager does", () => {
    expect(toolSizeLabel(512)).toBe("512 B");
    expect(toolSizeLabel(3 * 1024 + 300)).toBe("3.3 KB");
    expect(toolSizeLabel(40 * 1024)).toBe("40 KB");
    expect(toolSizeLabel(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});

describe("useToolResult with another source", () => {
  it("reads the result from the source the provider gives (the weft.zip board's cloud_tool_outputs)", async () => {
    const source = vi.fn().mockResolvedValue("from the cloud");
    const wrapper = ({ children }: { children: ReactNode }) => createElement(ToolResultSourceContext.Provider, { value: source }, children);
    const ref = details();
    const { result } = renderHook(() => useToolResult("c1", "t1", true, undefined, ref), { wrapper });
    open(ref);
    await waitFor(() => expect(result.current.fetched).toBe("from the cloud"));
    expect(source).toHaveBeenCalledWith("c1", "t1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks the row errored when the source rejects", async () => {
    const source = vi.fn().mockRejectedValue(new Error("nope"));
    const wrapper = ({ children }: { children: ReactNode }) => createElement(ToolResultSourceContext.Provider, { value: source }, children);
    const ref = details();
    const { result } = renderHook(() => useToolResult("c1", "t1", true, undefined, ref), { wrapper });
    open(ref);
    await waitFor(() => expect(result.current.errored).toBe(true));
  });
});

describe("useToolResult", () => {
  it("passes a result it already has straight through and never fetches", () => {
    const ref = details();
    const { result } = renderHook(() => useToolResult("c1", "t1", false, "done", ref));
    open(ref);
    expect(result.current).toEqual({ fetched: "done", loading: false, errored: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches a trimmed result the first time the row opens, and only once", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ result: "long output" }) });
    const ref = details();
    const { result } = renderHook(() => useToolResult("c1", "t/1", true, undefined, ref));
    expect(result.current.loading).toBe(true);
    // A toggle that closes the row doesn't fetch.
    act(() => void ref.current.dispatchEvent(new Event("toggle")));
    expect(fetchMock).not.toHaveBeenCalled();
    open(ref);
    open(ref);
    await waitFor(() => expect(result.current.fetched).toBe("long output"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/cards/c1/thread/tool/t%2F1");
    expect(result.current).toEqual({ fetched: "long output", loading: false, errored: false });
    // Once it has the result, opening again doesn't fetch again.
    open(ref);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("marks a failed fetch as errored", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const ref = details();
    const { result } = renderHook(() => useToolResult("c1", "t1", true, undefined, ref));
    open(ref);
    await waitFor(() => expect(result.current.errored).toBe(true));
    expect(result.current.loading).toBe(false);
  });

  it("does nothing before the row is in the page", () => {
    const { result } = renderHook(() => useToolResult("c1", "t1", true, undefined, { current: null }));
    expect(result.current.loading).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
