// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import { ShareWork } from "./MacPairing";

function bridge(over: Record<string, unknown> = {}) {
  const b = {
    code: vi.fn(() => Promise.resolve("weft-mac1:abc")),
    trust: vi.fn(() => Promise.resolve({ id: "x", name: "Studio" } as { id: string; name: string } | null)),
    list: vi.fn(() => Promise.resolve([] as { id: string; name: string; pairedAt: string }[])),
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
const openIt = () => fireEvent.click(screen.getByText("Share work…"));

describe("ShareWork", () => {
  it("draws nothing without the desktop bridge", () => {
    const { container } = render(<ShareWork id="x" name="Studio" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("copies this Mac's code, with the direction said right", async () => {
    const b = bridge();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ShareWork id="x" name="Studio" />);
    expect(screen.queryByText("Copy code for Studio")).toBeNull();
    openIt();
    expect(screen.getByText("Paste it in Weft on Studio so this Mac can pull Studio's uncommitted work.")).toBeInTheDocument();
    expect(screen.getByText("Paste Studio's code so Studio can pull this Mac's uncommitted work.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Copy code for Studio"));
    expect(await screen.findByText("Copied.")).toBeInTheDocument();
    expect(b.code).toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("weft-mac1:abc");
  });

  it("says why copying failed", async () => {
    bridge({ code: vi.fn(() => Promise.reject(new Error("Error invoking remote method 'mac-pair:code': Error: no key"))) });
    render(<ShareWork id="x" name="Studio" />);
    openIt();
    fireEvent.click(screen.getByText("Copy code for Studio"));
    expect(await screen.findByText("no key")).toBeInTheDocument();
  });

  it("allows a pasted code, then clears the field and shows the pin", async () => {
    const b = bridge();
    render(<ShareWork id="x" name="Studio" />);
    openIt();
    const allow = screen.getByText("Allow");
    expect(allow).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Studio's code"), { target: { value: "weft-mac1:zzz" } });
    b.list.mockResolvedValue([{ id: "x", name: "Studio", pairedAt: "t" }]);
    fireEvent.click(allow);
    await waitFor(() => expect(b.trust).toHaveBeenCalledWith("weft-mac1:zzz"));
    expect(await screen.findByText(/Studio can pull this Mac's work/)).toBeInTheDocument();
    expect(screen.getByLabelText("Studio's code")).toHaveValue("");
  });

  it("keeps the code when Touch ID is refused, and shows a refused code's reason", async () => {
    const b = bridge({ trust: vi.fn(() => Promise.resolve(null)) });
    render(<ShareWork id="x" name="Studio" />);
    openIt();
    const input = screen.getByLabelText("Studio's code");
    fireEvent.change(input, { target: { value: "c" } });
    fireEvent.click(screen.getByText("Allow"));
    await waitFor(() => expect(b.trust).toHaveBeenCalled());
    expect(input).toHaveValue("c");
    b.trust.mockRejectedValueOnce("That code names no Mac.");
    fireEvent.click(screen.getByText("Allow"));
    expect(await screen.findByText("That code names no Mac.")).toBeInTheDocument();
  });

  it("shows a pin for this Mac's id only, and stops it", async () => {
    const b = bridge({ list: vi.fn(() => Promise.resolve([{ id: "other", name: "Other", pairedAt: "t" }, { id: "x", name: "Studio", pairedAt: "t" }])) });
    render(<ShareWork id="x" name="Studio" />);
    fireEvent.click(await screen.findByLabelText("Stop Studio pulling this Mac's work"));
    await waitFor(() => expect(b.forget).toHaveBeenCalledWith("x"));
  });

  it("shows no pin for an unpinned or id-less Mac, and survives a failing list", async () => {
    bridge({ list: vi.fn(() => Promise.reject(new Error("x"))) });
    render(<ShareWork id={null} name="Studio" />);
    expect(await screen.findByText("Share work…")).toBeInTheDocument();
    expect(screen.queryByText(/can pull this Mac's work/)).toBeNull();
  });
});
