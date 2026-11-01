// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";

const api = vi.hoisted(() => ({ readQa: vi.fn(), sendWorkerAction: vi.fn() }));
vi.mock("@/lib/worker-transport", () => api);

const { QaSwitch, useQa } = await import("./QaSwitch");

const IPHONE = { id: "udid-1", name: "iPhone 17", platform: "ios", state: "booted", runtime: "iOS 26" };
const PIXEL = { id: "emulator-5554", name: "Weft_Pixel_9", platform: "android", state: "booted" };

type Card = Parameters<typeof useQa>[0];

// The switch as the worker card draws it: the hook feeds the button.
function Harness({ card }: { card: Card }) {
  const qa = useQa(card);
  return <QaSwitch card={card} qa={qa} />;
}

beforeEach(() => {
  api.readQa.mockReset();
  api.sendWorkerAction.mockReset();
  api.sendWorkerAction.mockResolvedValue(undefined);
});

describe("QaSwitch", () => {
  it("offers this Mac's devices, and says what saying yes means", async () => {
    api.readQa.mockResolvedValue({ devices: [IPHONE, PIXEL], mac: "mac-1", approved: null });
    render(<Harness card={{ id: "c1" }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Manual QA/ }));
    expect(screen.getByText(/run on your Mac as you, for 8 hours/)).toBeTruthy();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("names an iOS device by its udid and an emulator by its name", async () => {
    api.readQa.mockResolvedValue({ devices: [IPHONE, PIXEL], mac: "mac-1", approved: null });
    render(<Harness card={{ id: "c1" }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Manual QA/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Weft_Pixel_9/ }));
    await waitFor(() => expect(api.sendWorkerAction).toHaveBeenCalledWith({ action: "qa", cardId: "c1", device: "Weft_Pixel_9" }));
  });

  it("sends the udid for a simulator", async () => {
    api.readQa.mockResolvedValue({ devices: [IPHONE], mac: "mac-1", approved: null });
    render(<Harness card={{ id: "c1" }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Manual QA/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /iPhone 17/ }));
    await waitFor(() => expect(api.sendWorkerAction).toHaveBeenCalledWith({ action: "qa", cardId: "c1", device: "udid-1" }));
  });

  it("shows a refusal on the button, and stays off", async () => {
    api.readQa.mockResolvedValue({ devices: [IPHONE], mac: "mac-1", approved: null });
    api.sendWorkerAction.mockRejectedValue(new Error("Manual QA stays off: you didn't approve it."));
    render(<Harness card={{ id: "c1" }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Manual QA/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /iPhone 17/ }));
    const button = await screen.findByRole("button", { name: /Manual QA ⚠/ });
    expect(button.getAttribute("title")).toBe("Manual QA stays off: you didn't approve it.");
  });

  it("points at Settings when this Mac has no simulators", async () => {
    api.readQa.mockResolvedValue({ devices: [], mac: "mac-1", approved: null });
    render(<Harness card={{ id: "c1" }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Manual QA/ }));
    expect(screen.getByText(/Settings → Connectors → Simulators/)).toBeTruthy();
  });

  it("is on only when this Mac approved it and the worker points at this Mac", async () => {
    api.readQa.mockResolvedValue({ devices: [IPHONE], mac: "mac-1", approved: "iPhone 17" });
    render(<Harness card={{ id: "c1", qaDevice: "mac-1" }} />);
    expect(await screen.findByRole("button", { name: /QA on iPhone 17/ })).toBeTruthy();
  });

  it("reads as off when the approval has lapsed, so a click asks again", async () => {
    api.readQa.mockResolvedValue({ devices: [IPHONE], mac: "mac-1", approved: null });
    render(<Harness card={{ id: "c1", qaDevice: "mac-1" }} />);
    expect(await screen.findByRole("button", { name: /Manual QA/ })).toBeTruthy();
    expect(screen.queryByText(/QA on/)).toBeNull();
  });

  it("reads as off when the worker points at another Mac", async () => {
    api.readQa.mockResolvedValue({ devices: [IPHONE], mac: "mac-1", approved: "iPhone 17" });
    render(<Harness card={{ id: "c1", qaDevice: "mac-2" }} />);
    expect(await screen.findByRole("button", { name: /Manual QA/ })).toBeTruthy();
  });

  it("switches off with a null device", async () => {
    api.readQa.mockResolvedValue({ devices: [IPHONE], mac: "mac-1", approved: "iPhone 17" });
    render(<Harness card={{ id: "c1", qaDevice: "mac-1" }} />);
    fireEvent.click(await screen.findByRole("button", { name: /QA on iPhone 17/ }));
    await waitFor(() => expect(api.sendWorkerAction).toHaveBeenCalledWith({ action: "qa", cardId: "c1", device: null }));
  });

  it("stays disabled while the Mac's state can't be read", async () => {
    api.readQa.mockRejectedValue(new Error("HTTP 500"));
    render(<Harness card={{ id: "c1" }} />);
    await waitFor(() => expect(api.readQa).toHaveBeenCalled());
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Manual QA/ }).disabled).toBe(true);
  });
});
