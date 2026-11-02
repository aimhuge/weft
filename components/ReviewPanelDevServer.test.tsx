// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/client";
import type { DevServerStatus } from "@/lib/types";
import { ReviewPanelDevServer } from "./ReviewPanelDevServer";

vi.mock("@/lib/client", () => ({ api: { devAction: vi.fn(), devStatus: vi.fn() } }));

const plan = { url: "http://localhost:8080", dev: "pnpm dev", steps: [{ title: "Grip", path: "/lab/grip?x=1" }] };
const stepUrl = "http://localhost:8080/lab/grip?x=1";

const up: DevServerStatus = { state: "running", reachable: true, log: "" };
const down: DevServerStatus = { state: "starting", reachable: false, log: "" };
const crashed: DevServerStatus = { state: "failed", reachable: false, log: "" };

const open = vi.fn(() => Promise.resolve());
const getState = vi.fn();

function paneOn(url: string, loading = false) {
  getState.mockResolvedValue({ url, loading });
}

// Mounts the panel with `first` as the start's answer.
async function mount(first: DevServerStatus, url: string | undefined = stepUrl) {
  vi.mocked(api.devAction).mockResolvedValue({ status: first });
  const view = render(<ReviewPanelDevServer cardId="c1" plan={plan} stepUrl={url} />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  return view;
}

// The next 3-second status poll answers `status`.
async function poll(status: DevServerStatus) {
  vi.mocked(api.devStatus).mockResolvedValue({ status });
  await act(() => vi.advanceTimersByTimeAsync(3000));
}

beforeEach(() => {
  vi.useFakeTimers();
  open.mockClear();
  getState.mockReset();
  paneOn(stepUrl);
  window.weft = { browser: { open, getState } } as unknown as typeof window.weft;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.weft = undefined;
});

describe("ReviewPanelDevServer", () => {
  it("doesn't reopen the pane when reachable goes true, false, true", async () => {
    await mount(up);
    await poll(down);
    await poll(down);
    await poll(up);
    expect(open).not.toHaveBeenCalled();
  });

  it("never opens the plan's root over the step", async () => {
    paneOn("");
    await mount(down);
    await poll(up);
    expect(open).toHaveBeenCalledWith(stepUrl, "c1");
    expect(open).not.toHaveBeenCalledWith(plan.url, "c1");
  });

  it("shows the step once the server first answers, then never again", async () => {
    await mount(down);
    expect(open).not.toHaveBeenCalled();
    await poll(up);
    expect(open).toHaveBeenCalledTimes(1);
    await poll(down);
    await poll(down);
    await poll(up);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens the step the tour has moved to while the server was starting", async () => {
    const view = await mount(down);
    view.rerender(<ReviewPanelDevServer cardId="c1" plan={plan} stepUrl="http://localhost:8080/two" />);
    paneOn("http://localhost:8080/two");
    await poll(up);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("http://localhost:8080/two", "c1");
  });

  it("leaves the user where they went inside the app", async () => {
    paneOn("http://localhost:8080/lab/other");
    await mount(down);
    await poll(up);
    expect(open).not.toHaveBeenCalled();
  });

  it("leaves a page that's still loading to finish", async () => {
    paneOn(stepUrl, true);
    await mount(down);
    await poll(up);
    expect(open).not.toHaveBeenCalled();
  });

  it("opens over a blank pane", async () => {
    paneOn("about:blank");
    await mount(down);
    await poll(up);
    expect(open).toHaveBeenCalledWith(stepUrl, "c1");
  });

  it("has nothing to open on a step without a page", async () => {
    await mount(down, "");
    await poll(up);
    expect(getState).not.toHaveBeenCalled();
  });

  it("keeps saying running through one missed check, and not through two", async () => {
    await mount(up);
    await poll(down);
    expect(screen.getByText(/running/)).toBeTruthy();
    await poll(down);
    expect(screen.getByText(/starting/)).toBeTruthy();
  });

  it("counts the miss afresh after the server answers again", async () => {
    await mount(up);
    await poll(down);
    await poll(up);
    await poll(down);
    expect(screen.getByText(/running/)).toBeTruthy();
  });

  it("says crashed on the first check after a crash", async () => {
    await mount(up);
    await poll(crashed);
    expect(screen.getByText(/crashed/)).toBeTruthy();
  });
});
