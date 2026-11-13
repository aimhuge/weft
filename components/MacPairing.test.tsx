// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import { MacPairing } from "./MacPairing";

function bridge(over: Record<string, unknown> = {}) {
  const b = {
    code: vi.fn(() => Promise.resolve("weft-mac1:abc")),
    trust: vi.fn(() => Promise.resolve({ id: "x", name: "Studio" } as { id: string; name: string } | null)),
    list: vi.fn(() => Promise.resolve([{ id: "x", name: "Studio", pairedAt: "t" }])),
    forget: vi.fn(() => Promise.resolve(true)),
    ...over,
  };
  (window as unknown as { weft: unknown }).weft = { macPair: b };
  return b;
}
afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
  vi.restoreAllMocks();
});

describe("MacPairing", () => {
  it("draws nothing without the desktop bridge", () => {
    const { container } = render(<MacPairing />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the paired Macs and forgets one", async () => {
    const b = bridge();
    render(<MacPairing />);
    expect(await screen.findByText(/Studio/)).toBeInTheDocument();
    b.list.mockResolvedValue([]);
    fireEvent.click(screen.getByLabelText("Forget Studio"));
    await waitFor(() => expect(b.forget).toHaveBeenCalledWith("x"));
    expect(await screen.findByText("Studio can no longer ask this Mac for its work.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText("Forget Studio")).toBeNull());
  });

  it("copies this Mac's code", async () => {
    const b = bridge();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<MacPairing />);
    fireEvent.click(screen.getByText("Copy This Mac's Code"));
    expect(await screen.findByText(/Copied this Mac's code/)).toBeInTheDocument();
    expect(b.code).toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("weft-mac1:abc");
  });

  it("says why copying failed", async () => {
    bridge({ code: vi.fn(() => Promise.reject(new Error("Error invoking remote method 'mac-pair:code': Error: no key"))) });
    render(<MacPairing />);
    fireEvent.click(screen.getByText("Copy This Mac's Code"));
    expect(await screen.findByText("no key")).toBeInTheDocument();
  });

  it("pairs a pasted code, then clears the field", async () => {
    const b = bridge();
    render(<MacPairing />);
    const pair = screen.getByText("Pair");
    expect(pair).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Another Mac's code"), { target: { value: "weft-mac1:zzz" } });
    fireEvent.click(pair);
    expect(await screen.findByText("Studio can now ask this Mac for its uncommitted work.")).toBeInTheDocument();
    expect(b.trust).toHaveBeenCalledWith("weft-mac1:zzz");
    expect(screen.getByLabelText("Another Mac's code")).toHaveValue("");
  });

  it("keeps the code when Touch ID is refused, and shows a refused code's reason", async () => {
    const b = bridge({ trust: vi.fn(() => Promise.resolve(null)) });
    render(<MacPairing />);
    const input = screen.getByLabelText("Another Mac's code");
    fireEvent.change(input, { target: { value: "c" } });
    fireEvent.click(screen.getByText("Pair"));
    await waitFor(() => expect(b.trust).toHaveBeenCalled());
    expect(input).toHaveValue("c");
    b.trust.mockRejectedValueOnce("That code names no Mac.");
    fireEvent.click(screen.getByText("Pair"));
    expect(await screen.findByText("That code names no Mac.")).toBeInTheDocument();
  });

  it("survives a failing list", async () => {
    bridge({ list: vi.fn(() => Promise.reject(new Error("x"))) });
    render(<MacPairing />);
    expect(await screen.findByText("Your other Macs")).toBeInTheDocument();
  });
});
