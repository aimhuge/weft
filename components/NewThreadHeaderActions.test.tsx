// @vitest-environment jsdom
// The New thread window's ⏰ and ✕: the ⏰ puts the prompt you're writing on a cron instead of starting it
// once — each run is a fresh card with that prompt, folder, model and mode.

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NewThreadHeaderActions, { type NewThreadPicks } from "./NewThreadHeaderActions";
import "./test-utils";

const cronApi = vi.hoisted(() => ({ create: vi.fn(() => Promise.resolve({ cron: {} })) }));
vi.mock("@/lib/cron-client", () => ({ cronApi }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const picks: NewThreadPicks = { cwd: "/Users/me/dev/weft", backend: "claude", permissionMode: "default" };

function setup(over: Partial<React.ComponentProps<typeof NewThreadHeaderActions>> = {}) {
  const props: React.ComponentProps<typeof NewThreadHeaderActions> = {
    read: () => "ship the release",
    picks,
    onCreated: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  return { props, view: render(<NewThreadHeaderActions {...props} />) };
}

describe("NewThreadHeaderActions", () => {
  it("opens the cron's form from the ⏰", () => {
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Run on a cron"));
    expect(view.getByText("⏰ Run this on a cron")).toBeInTheDocument();
    // The prompt is the composer above, so the form leaves its own out.
    expect(view.queryByLabelText("What each run sends")).toBeNull();
  });

  it("closes the window from the ✕", () => {
    const { props, view } = setup();
    fireEvent.click(view.getByLabelText("Close"));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("makes a cron of the prompt you're writing, with the picks you made", async () => {
    const { props, view } = setup();
    fireEvent.click(view.getByLabelText("Run on a cron"));
    fireEvent.click(view.getByRole("button", { name: "Create cron" }));
    await waitFor(() =>
      expect(cronApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "ship the release", cwd: "/Users/me/dev/weft", backend: "claude", permissionMode: "default", mode: "fresh" }),
      ),
    );
    expect(props.onCreated).toHaveBeenCalled();
    expect(view.queryByText("⏰ Run this on a cron")).toBeNull();
  });

  it("asks you to write the prompt first", async () => {
    const { view } = setup({ read: () => "   " });
    fireEvent.click(view.getByLabelText("Run on a cron"));
    fireEvent.click(view.getByRole("button", { name: "Create cron" }));
    await waitFor(() => expect(view.getByText("Write the prompt first.")).toBeInTheDocument());
    expect(cronApi.create).not.toHaveBeenCalled();
  });

  it("says why else it can't be made", async () => {
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Run on a cron"));
    // The end day before the start day: the cron would never run.
    const end = view.getByLabelText("Ends");
    fireEvent.change(end, { target: { value: "2020-01-01" } });
    fireEvent.click(view.getByRole("button", { name: "Create cron" }));
    await waitFor(() => expect(view.getByText(/ends before it starts/)).toBeInTheDocument());
    expect(cronApi.create).not.toHaveBeenCalled();
  });

  it("runs it now as well, which it does by default", async () => {
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Run on a cron"));
    fireEvent.click(view.getByRole("button", { name: "Create cron" }));
    await waitFor(() => expect(cronApi.create).toHaveBeenCalledWith(expect.objectContaining({ runNow: true })));
  });

  it("leaves the run now out when you untick it", async () => {
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Run on a cron"));
    fireEvent.click(view.getByLabelText("Also run now"));
    fireEvent.click(view.getByRole("button", { name: "Create cron" }));
    await waitFor(() => expect(cronApi.create).toHaveBeenCalledWith(expect.objectContaining({ runNow: false })));
  });

  it("drops an effort the backend doesn't take", async () => {
    const { view } = setup({ picks: { ...picks, backend: "puku", effort: "xhigh" } });
    fireEvent.click(view.getByLabelText("Run on a cron"));
    fireEvent.click(view.getByRole("button", { name: "Create cron" }));
    await waitFor(() => expect(cronApi.create).toHaveBeenCalledWith(expect.objectContaining({ effort: "high" })));
  });

  it("closes the form on a click outside", () => {
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Run on a cron"));
    fireEvent.mouseDown(document.body);
    expect(view.queryByText("⏰ Run this on a cron")).toBeNull();
  });

  it("stays open on a click inside it", () => {
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Run on a cron"));
    fireEvent.mouseDown(view.getByText("⏰ Run this on a cron"));
    expect(view.getByText("⏰ Run this on a cron")).toBeInTheDocument();
  });

  it("opens and closes on the ⏰ again", () => {
    const { view } = setup();
    const clock = view.getByLabelText("Run on a cron");
    fireEvent.click(clock);
    expect(clock).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(clock);
    expect(clock).toHaveAttribute("aria-expanded", "false");
  });
});
