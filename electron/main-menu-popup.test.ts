import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMenuPopup } from "./main-menu-popup.cjs";

// The board's right-click popup: takes a list of items, shows a native menu, resolves to the
// picked item's id (or null). Menu and BrowserWindow are injected so we don't need a real
// Electron, and the click → resolve wiring is the thing we actually want to assert.

type MenuItem = { id?: string; label?: string; type?: "separator"; enabled?: boolean; checked?: boolean; accelerator?: string; detail?: string };

const items: MenuItem[] = [
  { id: "rename", label: "Rename" },
  { id: "delete", label: "Delete", accelerator: "CmdOrCtrl+Backspace" },
  { type: "separator" },
  { id: "open", label: "Open", enabled: false },
  { id: "pinned", label: "Pinned", checked: true },
  { id: "sync", label: "Sync weft", detail: "Synced 7m ago" },
];

const popup = vi.fn();
const buildFromTemplate = vi.fn();
const fromWebContents = vi.fn((wc: unknown) => wc);

beforeEach(() => {
  buildFromTemplate.mockReset();
  buildFromTemplate.mockImplementation(() => ({ popup }));
  popup.mockReset();
});

function makeHandler() {
  const handlers = new Map<string, (e: unknown, payload: unknown) => unknown>();
  const ipcMain = { handle: (ch: string, fn: (e: unknown, payload: unknown) => unknown) => handlers.set(ch, fn) };
  createMenuPopup({ ipcMain, Menu: { buildFromTemplate }, BrowserWindow: { fromWebContents } });
  const handler = handlers.get("menu:popup");
  if (!handler) throw new Error("menu:popup handler not registered");
  return { handler };
}

describe("createMenuPopup", () => {
  it("registers a menu:popup handler that resolves to the picked id", async () => {
    const { handler } = makeHandler();
    const promise = handler({ sender: "wc" }, items);
    expect(buildFromTemplate).toHaveBeenCalledTimes(1);
    const template = buildFromTemplate.mock.calls[0]?.[0] as MenuItem[] | undefined;
    if (!template) throw new Error("buildFromTemplate received no template");
    // Separators, regular items, disabled items, and checkbox items all pass through.
    expect(template[0]).toMatchObject({ label: "Rename", enabled: true });
    expect(template[1]).toMatchObject({ label: "Delete", accelerator: "CmdOrCtrl+Backspace" });
    expect(template[2]).toEqual({ type: "separator" });
    expect(template[3]).toMatchObject({ label: "Open", enabled: false });
    expect(template[4]).toMatchObject({ label: "Pinned", type: "checkbox", checked: true });
    // An item's detail becomes Electron's sublabel: the dimmer second line beside the status.
    expect(template[5]).toMatchObject({ label: "Sync weft", sublabel: "Synced 7m ago" });
    // The native menu popup is anchored to the WebContents that asked for it.
    expect(popup).toHaveBeenCalledWith(expect.objectContaining({ window: "wc" }));
    // Clicking an item resolves the promise with its id after the popup callback's tick.
    const first = template[0] as { click: () => void };
    first.click();
    const args = popup.mock.calls[0]?.[0] as { callback: () => void } | undefined;
    args?.callback();
    await new Promise((r) => setTimeout(r, 5));
    await expect(promise).resolves.toBe("rename");
  });

  it("resolves to null when the popup is dismissed without a click", async () => {
    const { handler } = makeHandler();
    const promise = handler({ sender: "wc" }, items);
    const args = popup.mock.calls[0]?.[0] as { callback: () => void } | undefined;
    args?.callback();
    await new Promise((r) => setTimeout(r, 5));
    await expect(promise).resolves.toBeNull();
  });
});
