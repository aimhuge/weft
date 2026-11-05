// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./test-utils";

const printing = vi.hoisted(() => ({ printerNames: vi.fn(), printHtml: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/print-sheet", () => printing);

const { PrintSheetButton, PrintSheetOffer } = await import("./PrintShortcutSheet");

afterEach(() => vi.clearAllMocks());

describe("PrintSheetOffer", () => {
  it("pitches the sheet and prints it when the Mac has a printer", async () => {
    printing.printerNames.mockResolvedValue(["Office"]);
    render(<PrintSheetOffer />);
    await userEvent.click(await screen.findByRole("button", { name: /Print the sheet/ }));
    expect(screen.getByText("Weft is quickest from the keyboard.")).toBeInTheDocument();
    expect(printing.printHtml).toHaveBeenCalledWith(expect.stringContaining("Weft · keyboard shortcuts"));
  });
  it("offers nothing without a printer", async () => {
    printing.printerNames.mockResolvedValue([]);
    const { container } = render(<PrintSheetOffer />);
    await vi.waitFor(() => expect(printing.printerNames).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PrintSheetButton", () => {
  it("prints the sections it's given", async () => {
    const sections = [{ group: "General" as const, items: [{ id: "n", keys: ["n"], description: "New thread", group: "General" as const }] }];
    render(<PrintSheetButton sections={sections} mac />);
    await userEvent.click(screen.getByRole("button", { name: /Print/ }));
    expect(printing.printHtml).toHaveBeenCalledWith(expect.stringContaining("<span>New thread</span>"));
  });
});
