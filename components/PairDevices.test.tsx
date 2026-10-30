// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { PairingBridge } from "@/lib/use-pairing";

vi.mock("@/lib/use-now", () => ({ useNow: () => 1_000_000 }));
const { default: PairDevices, QrCode } = await import("./PairDevices");

const PHONE = { id: "p1", name: "Alex's iPhone", kind: "phone" as const, platform: "ios", fingerprint: "abcdef0123456789", pairedAt: "t" };
let bridge: { [K in keyof PairingBridge]: ReturnType<typeof vi.fn> };

beforeEach(() => {
  bridge = {
    start: vi.fn(() => Promise.resolve({ id: "code-1", link: "https://weft.zip/pair#v=1&p=x", expiresAt: 1_000_000 + 125_000 })),
    check: vi.fn(() => Promise.resolve({ status: "open" })),
    cancel: vi.fn(() => Promise.resolve()),
    list: vi.fn(() => Promise.resolve([PHONE])),
    revoke: vi.fn(() => Promise.resolve({ ok: true })),
    settings: vi.fn(() => Promise.resolve({ seal: false, webApprovals: false })),
    setSettings: vi.fn((c: Record<string, boolean>) => Promise.resolve({ seal: false, webApprovals: false, ...c })),
  };
  (window as unknown as { weft: unknown }).weft = { pairing: bridge };
});
afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("PairDevices", () => {
  it("draws nothing outside the desktop app", () => {
    delete (window as unknown as { weft?: unknown }).weft;
    const { container } = render(<PairDevices />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists paired devices and revokes one", async () => {
    render(<PairDevices />);
    expect(await screen.findByText("Alex's iPhone")).toBeInTheDocument();
    expect(screen.getByText(/approves with Face ID/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Revoke Alex's iPhone" }));
    expect(bridge.revoke).toHaveBeenCalledWith("p1");
  });

  it("shows a QR code while a code is open, then the outcome", async () => {
    render(<PairDevices />);
    await userEvent.click(await screen.findByRole("button", { name: "Pair a phone" }));
    expect(await screen.findByRole("img", { name: "Pairing QR code" })).toBeInTheDocument();
    expect(screen.getByText(/2:05 more/)).toBeInTheDocument();
    bridge.check.mockResolvedValueOnce({ status: "paired", device: PHONE });
    expect(await screen.findByText("Paired Alex's iPhone.", undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(bridge.check).toHaveBeenCalledWith("code-1");
    expect(screen.queryByRole("img", { name: "Pairing QR code" })).toBeNull();
  });

  it("cancels an open code", async () => {
    render(<PairDevices />);
    await userEvent.click(await screen.findByRole("button", { name: "Pair a phone" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(bridge.cancel).toHaveBeenCalledWith("code-1");
    expect(screen.getByRole("button", { name: "Pair a phone" })).toBeInTheDocument();
  });

  it("flips the switches through main and shows main's errors", async () => {
    render(<PairDevices />);
    await userEvent.click(await screen.findByRole("switch", { name: "Seal synced threads" }));
    expect(bridge.setSettings).toHaveBeenCalledWith({ seal: true });
    bridge.start.mockRejectedValueOnce(new Error("Sign in first"));
    await userEvent.click(screen.getByRole("button", { name: "Pair a phone" }));
    expect(await screen.findByText("Sign in first")).toBeInTheDocument();
  });
});

describe("QrCode", () => {
  it("draws the link's modules", () => {
    const { container } = render(<QrCode text="https://weft.zip/pair#x" size={100} />);
    expect(container.querySelector("path")?.getAttribute("d")).toMatch(/^M\d+ \d+h1v1h-1z/);
  });
});
