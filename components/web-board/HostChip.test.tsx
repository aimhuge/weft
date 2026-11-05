// @vitest-environment jsdom
// The host chip in a worker card's pane header: what it reads, and what its menu does.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostChip, NOT_YET, type LocalSimulator } from "./HostChip";

const IPHONE = { id: "udid-1", name: "iPhone 17", platform: "ios" as const, state: "booted" as const, runtime: "iOS 26" };
const PIXEL = { id: "emulator-5554", name: "Weft_Pixel_9", platform: "android" as const, state: "booted" as const };
const SCREEN = { device: "udid-w", label: "iPhone 16", devices: [{ id: "udid-w", name: "iPhone 16" }, { id: "udid-x", name: "iPad Air" }] };

function local(over: Partial<LocalSimulator> = {}): LocalSimulator {
  return { on: false, ready: true, approved: null, devices: [IPHONE, PIXEL], busy: false, problem: "", send: vi.fn(), ...over };
}
const chip = () => screen.getByRole("button", { expanded: false });
const openMenu = () => fireEvent.click(chip());

afterEach(cleanup);

describe("HostChip's label", () => {
  it("names the worker", () => {
    render(<HostChip worker="m1mini" local={local()} />);
    expect(chip().textContent).toBe("m1mini");
  });

  it("adds the simulator while the worker streams one", () => {
    render(<HostChip worker="m1mini" screen={SCREEN} local={local()} />);
    expect(chip().textContent).toBe("m1mini + simulator");
  });

  it("says this Mac in Local Simulator mode", () => {
    render(<HostChip worker="m1mini" local={local({ on: true, approved: "iPhone 17" })} />);
    expect(chip().textContent).toBe("this Mac + simulator");
  });

  it("waits for Touch ID, and flags a refusal in its title", () => {
    const { rerender } = render(<HostChip worker="m1mini" local={local({ busy: true })} />);
    expect(screen.getByRole<HTMLButtonElement>("button").disabled).toBe(true);
    expect(screen.getByRole("button").textContent).toBe("Waiting for Touch ID…");
    rerender(<HostChip worker="m1mini" local={local({ problem: "Local Simulator stays off: you didn't approve it." })} />);
    expect(chip().textContent).toBe("m1mini ⚠");
    expect(chip().getAttribute("title")).toBe("Local Simulator stays off: you didn't approve it.");
  });

  it("is hidden on the web with nothing host-specific to offer", () => {
    const { container } = render(<HostChip />);
    expect(container.innerHTML).toBe("");
  });

  it("shows on the web while a simulator streams, as Worker where the name isn't known", () => {
    render(<HostChip screen={SCREEN} />);
    expect(chip().textContent).toBe("Worker + simulator");
    openMenu();
    expect(screen.getByText("Streaming iPhone 16.")).toBeTruthy();
    expect(screen.queryByText(/Simulator on this Mac/)).toBeNull();
  });
});

describe("HostChip's menu", () => {
  it("starts the worker's simulator for a mobile app", () => {
    const onScreenInput = vi.fn(() => Promise.resolve());
    render(<HostChip worker="m1mini" onScreenInput={onScreenInput} mobileApp />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Start simulator/ }));
    expect(onScreenInput).toHaveBeenCalledWith({ kind: "watch" });
    expect(screen.getByRole("button").textContent).toBe("Starting simulator…");
  });

  it("says why the worker's simulator didn't start", async () => {
    render(<HostChip worker="m1mini" onScreenInput={vi.fn(() => Promise.reject(new Error("no simulators")))} mobileApp />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Start simulator/ }));
    await waitFor(() => expect(chip().getAttribute("title")).toBe("no simulators"));
    expect(chip().textContent).toBe("m1mini ⚠");
  });

  it("switches the worker's streamed device", () => {
    const onScreenInput = vi.fn(() => Promise.resolve());
    render(<HostChip worker="m1mini" screen={SCREEN} onScreenInput={onScreenInput} local={local()} />);
    openMenu();
    expect(screen.getByRole("menuitemradio", { name: /iPhone 16/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: /iPad Air/ }));
    expect(onScreenInput).toHaveBeenCalledWith({ kind: "watch", device: "udid-x" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers this Mac's devices, says what yes means, and sends a stable id", () => {
    const sim = local();
    render(<HostChip worker="m1mini" local={sim} />);
    openMenu();
    expect(screen.getByText(/Builds from m1mini run on your Mac as you, for 8 hours/)).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Weft_Pixel_9/ }));
    expect(sim.send).toHaveBeenCalledWith("Weft_Pixel_9");
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /iPhone 17/ }));
    expect(sim.send).toHaveBeenCalledWith("udid-1");
  });

  it("stops Local Simulator, back to the worker's device", () => {
    const sim = local({ on: true, approved: "iPhone 17" });
    render(<HostChip worker="m1mini" local={sim} />);
    openMenu();
    expect(screen.queryByText(/Simulator on m1mini/)).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /Stop simulator/ }));
    expect(sim.send).toHaveBeenCalledWith(null);
  });

  it("points at Settings with no simulators here, and says when it can't read them", () => {
    const { rerender } = render(<HostChip worker="m1mini" local={local({ devices: [] })} />);
    openMenu();
    expect(screen.getByText(/Settings → Connectors → Simulators/)).toBeTruthy();
    rerender(<HostChip worker="m1mini" local={local({ ready: false, devices: [] })} />);
    expect(screen.getByText(/Can't read this Mac's devices/)).toBeTruthy();
  });

  it("shows Run this card on this Mac, off until there's a way to move a card", () => {
    const sim = local();
    render(<HostChip worker="m1mini" local={sim} />);
    openMenu();
    const run = screen.getByRole("menuitem", { name: /Run this card on this Mac/ });
    expect(run.getAttribute("aria-disabled")).toBe("true");
    expect(run.getAttribute("title")).toBe(NOT_YET);
    fireEvent.click(run);
    expect(sim.send).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    render(<HostChip worker="m1mini" local={local()} />);
    openMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
