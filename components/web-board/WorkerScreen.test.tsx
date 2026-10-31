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

const pane = (until: number) => ({ kind: "screen", url: "", label: "iPhone 17", token: "t", device: "d", until }) as Extract<SharePane, { kind: "screen" }>;
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
});
