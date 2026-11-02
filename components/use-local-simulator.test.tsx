// @vitest-environment jsdom
// Local Simulator mode's state on a worker card, as the host chip draws it.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";

const api = vi.hoisted(() => ({ readQa: vi.fn(), sendWorkerAction: vi.fn() }));
vi.mock("@/lib/worker-transport", () => api);

const { useLocalSimulator } = await import("./use-local-simulator");
const { HostChip } = await import("./web-board/HostChip");

const IPHONE = { id: "udid-1", name: "iPhone 17", platform: "ios", state: "booted", runtime: "iOS 26" };

type Card = Parameters<typeof useLocalSimulator>[0];

function Harness({ card }: { card: Card }) {
  return <HostChip worker="m1mini" local={useLocalSimulator(card)} />;
}
const chip = () => screen.getByRole("button", { expanded: false });

beforeEach(() => {
  api.readQa.mockReset();
  api.sendWorkerAction.mockReset();
  api.sendWorkerAction.mockResolvedValue(undefined);
});

describe("useLocalSimulator", () => {
  it("sends the picked device, and reads the state again", async () => {
    api.readQa.mockResolvedValue({ devices: [IPHONE], mac: "mac-1", approved: null });
    render(<Harness card={{ id: "c1" }} />);
    fireEvent.click(chip());
    fireEvent.click(await screen.findByRole("menuitem", { name: /iPhone 17/ }));
    await waitFor(() => expect(api.sendWorkerAction).toHaveBeenCalledWith({ action: "qa", cardId: "c1", device: "udid-1" }));
    await waitFor(() => expect(api.readQa).toHaveBeenCalledTimes(2));
  });

  it("shows a refusal on the chip, and stays off", async () => {
    api.readQa.mockResolvedValue({ devices: [IPHONE], mac: "mac-1", approved: null });
    api.sendWorkerAction.mockRejectedValue(new Error("Local Simulator stays off: you didn't approve it."));
    render(<Harness card={{ id: "c1" }} />);
    fireEvent.click(chip());
    fireEvent.click(await screen.findByRole("menuitem", { name: /iPhone 17/ }));
    await waitFor(() => expect(chip().getAttribute("title")).toBe("Local Simulator stays off: you didn't approve it."));
    expect(chip().textContent).toBe("m1mini ⚠");
  });

  it("is on only when this Mac approved it and the worker points at this Mac", async () => {
    api.readQa.mockResolvedValue({ devices: [IPHONE], mac: "mac-1", approved: "iPhone 17" });
    render(<Harness card={{ id: "c1", qaDevice: "mac-1" }} />);
    await waitFor(() => expect(chip().textContent).toBe("this Mac + simulator"));
  });

  it("reads as off when the approval has lapsed or the worker points at another Mac", async () => {
    api.readQa.mockResolvedValue({ devices: [IPHONE], mac: "mac-1", approved: null });
    const { unmount } = render(<Harness card={{ id: "c1", qaDevice: "mac-1" }} />);
    await waitFor(() => expect(api.readQa).toHaveBeenCalled());
    expect(chip().textContent).toBe("m1mini");
    unmount();
    api.readQa.mockResolvedValue({ devices: [IPHONE], mac: "mac-1", approved: "iPhone 17" });
    render(<Harness card={{ id: "c1", qaDevice: "mac-2" }} />);
    await waitFor(() => expect(api.readQa).toHaveBeenCalledTimes(2));
    expect(chip().textContent).toBe("m1mini");
  });

  it("switches off with a null device", async () => {
    api.readQa.mockResolvedValue({ devices: [IPHONE], mac: "mac-1", approved: "iPhone 17" });
    render(<Harness card={{ id: "c1", qaDevice: "mac-1" }} />);
    await waitFor(() => expect(chip().textContent).toBe("this Mac + simulator"));
    fireEvent.click(chip());
    fireEvent.click(screen.getByRole("menuitem", { name: /Stop simulator/ }));
    await waitFor(() => expect(api.sendWorkerAction).toHaveBeenCalledWith({ action: "qa", cardId: "c1", device: null }));
  });

  it("has nothing to pick while the Mac's state can't be read", async () => {
    api.readQa.mockRejectedValue(new Error("HTTP 500"));
    render(<Harness card={{ id: "c1" }} />);
    await waitFor(() => expect(api.readQa).toHaveBeenCalled());
    fireEvent.click(chip());
    expect(screen.getByText(/Can't read this Mac's devices/)).toBeTruthy();
  });
});
