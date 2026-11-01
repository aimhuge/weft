// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharePane } from "@/lib/share-types";

const stream = vi.hoisted(() => ({ onFrame: null as ((src: string) => void) | null }));
vi.mock("@/lib/use-screen-stream", async (actual) => ({
  ...(await actual<typeof import("@/lib/use-screen-stream")>()),
  useScreenStream: (_: string, onFrame: (src: string) => void) => {
    stream.onFrame = onFrame;
  },
}));

const { act } = await import("react");
const { WorkerScreen } = await import("./WorkerScreen");

const pane = (until: number, more: Partial<Extract<SharePane, { kind: "screen" }>> = {}) =>
  ({ kind: "screen", url: "", label: "iPhone 17", token: "t", device: "d", until, fast: false, devices: [], ...more }) as Extract<SharePane, { kind: "screen" }>;
const later = () => Date.now() + 60_000;

const capture = vi.fn();

afterEach(cleanup);

beforeEach(() => {
  capture.mockClear();
  Element.prototype.setPointerCapture = capture;
});

describe("WorkerScreen", () => {
  it("waits for a frame, then draws it", () => {
    render(<WorkerScreen pane={pane(later())} />);
    expect(screen.getByText(/Waiting for the first frame/)).toBeTruthy();
    act(() => stream.onFrame?.("data:image/jpeg;base64,x"));
    expect(screen.getByAltText("iPhone 17's screen")).toBeTruthy();
    expect(screen.getByText(/Live · until/)).toBeTruthy();
  });

  it("says when the watch has run out", () => {
    render(<WorkerScreen pane={pane(1)} />);
    expect(screen.getByText(/ask the thread to watch again/)).toBeTruthy();
  });

  it("sends a click as a tap and shows a tap that failed", async () => {
    const onInput = vi.fn(() => Promise.reject(new Error("not watched")));
    render(<WorkerScreen pane={pane(later())} onInput={onInput} />);
    act(() => stream.onFrame?.("data:image/jpeg;base64,x"));
    const img = screen.getByAltText("iPhone 17's screen");
    fireEvent.pointerDown(img, { clientX: 1, clientY: 1 });
    fireEvent.pointerUp(img, { clientX: 1, clientY: 1 });
    await waitFor(() => expect(onInput).toHaveBeenCalled());
    expect(onInput).toHaveBeenCalledWith(expect.objectContaining({ kind: "tap", device: "d" }));
    expect(screen.getByTestId("ripple")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("not watched")).toBeTruthy());
  });

  it("only watches where the board can't send taps", () => {
    render(<WorkerScreen pane={pane(later())} />);
    act(() => stream.onFrame?.("data:image/jpeg;base64,x"));
    const img = screen.getByAltText("iPhone 17's screen");
    fireEvent.pointerDown(img);
    fireEvent.pointerUp(img);
    expect(capture).not.toHaveBeenCalled();
  });

  it("says it streams from the worker, by name where the board knows it", () => {
    const { rerender } = render(<WorkerScreen pane={pane(later())} />);
    expect(screen.getByText(/streaming from the worker/)).toBeTruthy();
    rerender(<WorkerScreen pane={pane(later())} source="m1mini" />);
    expect(screen.getByText(/streaming from m1mini/)).toBeTruthy();
  });

  it("resumes a paused watch from the pane, and shows why it couldn't", async () => {
    const onInput = vi.fn(() => Promise.reject(new Error("worker offline")));
    render(<WorkerScreen pane={pane(1)} onInput={onInput} />);
    expect(screen.queryByText(/ask the thread/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Resume/ }));
    expect(onInput).toHaveBeenCalledWith({ kind: "watch", device: "d" });
    await waitFor(() => expect(screen.getByText("worker offline")).toBeTruthy());
    expect(screen.getByRole("button", { name: /Resume/ })).toBeTruthy();
  });

  it("switches device from the menu, listing the one on screen even when the worker didn't", () => {
    const onInput = vi.fn(() => Promise.resolve());
    render(<WorkerScreen pane={pane(later(), { devices: [{ id: "ipad", name: "iPad" }] })} onInput={onInput} />);
    const menu = screen.getByRole<HTMLSelectElement>("combobox", { name: "Device" });
    expect([...menu.options].map((o) => o.text)).toEqual(["iPhone 17", "iPad"]);
    fireEvent.change(menu, { target: { value: "ipad" } });
    expect(onInput).toHaveBeenCalledWith({ kind: "watch", device: "ipad" });
    expect(menu.disabled).toBe(true);
  });

  it("offers a quality on the WebRTC path, and keeps the pick", () => {
    const kept = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => kept.set(k, v) });
    render(<WorkerScreen pane={pane(later(), { fast: true })} onInput={vi.fn(() => Promise.resolve())} />);
    const menu = screen.getByRole<HTMLSelectElement>("combobox", { name: "Video quality" });
    expect(menu.value).toBe("medium");
    fireEvent.change(menu, { target: { value: "high" } });
    expect(localStorage.getItem("weft.screen-quality")).toBe("high");
    cleanup();
    render(<WorkerScreen pane={pane(later(), { fast: true })} onInput={vi.fn(() => Promise.resolve())} />);
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Video quality" }).value).toBe("high");
    vi.unstubAllGlobals();
  });

  it("shows no controls to a board that only watches", () => {
    render(<WorkerScreen pane={pane(1, { fast: true, devices: [{ id: "ipad", name: "iPad" }] })} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Resume/ })).toBeNull();
  });
});
