// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MenuAction, ShellBridge } from "./client";
import type { Card } from "./types";

const mocks = vi.hoisted(() => ({ addWebhookAsk: vi.fn() }));
vi.mock("./use-webhooks", () => ({ addWebhookAsk: mocks.addWebhookAsk }));

import { runMenuAction, useMenuBridge, type MenuBridge } from "./board-menu-bridge";
import { onThreadFind, onThreadFindStep } from "./find-events";
import { onAddressFocus } from "./pane-new-tab";

afterEach(() => {
  cleanup();
  delete window.weft;
  vi.clearAllMocks();
});

function bridge(over: Partial<MenuBridge> = {}): MenuBridge {
  return {
    cards: [{ id: "a" } as Card],
    openNew: vi.fn(),
    openCard: vi.fn(),
    select: vi.fn(),
    openSettings: vi.fn(),
    focusFilter: vi.fn(),
    toggleTerminal: vi.fn(),
    openDrawer: vi.fn(),
    ...over,
  };
}

describe("runMenuAction", () => {
  it("runs each simple action", () => {
    const b = bridge();
    runMenuAction("new-thread", undefined, b);
    runMenuAction("settings", undefined, b);
    runMenuAction("find", undefined, b);
    runMenuAction("terminal", undefined, b);
    expect(b.openNew).toHaveBeenCalledTimes(1);
    expect(b.openSettings).toHaveBeenCalledTimes(1);
    expect(b.focusFilter).toHaveBeenCalledTimes(1);
    expect(b.toggleTerminal).toHaveBeenCalledTimes(1);
  });

  it("hands ⌘T's new tab to the pane's address bar", () => {
    const focus = vi.fn();
    const off = onAddressFocus(focus);
    runMenuAction("new-tab", undefined, bridge());
    off();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("leaves the board's filter alone while a card is open", () => {
    const b = bridge({ cardOpen: true });
    runMenuAction("find", undefined, b);
    expect(b.focusFilter).not.toHaveBeenCalled();
  });

  it("leaves ⌘F to Settings' search while a dialog covers the thread", () => {
    const open = vi.fn();
    const off = onThreadFind(open);
    runMenuAction("find", undefined, bridge({ cardOpen: true, threadOpen: false }));
    off();
    expect(open).not.toHaveBeenCalled();
  });

  it("finds in the open thread, and steps it with ⌘G", () => {
    const open = vi.fn();
    const step = vi.fn();
    const offOpen = onThreadFind(open);
    const offStep = onThreadFindStep(step);
    const b = bridge({ cardOpen: true, threadOpen: true });
    runMenuAction("find", undefined, b);
    runMenuAction("find-next", undefined, b);
    runMenuAction("find-previous", undefined, b);
    offOpen();
    offStep();
    expect(open).toHaveBeenCalledTimes(1);
    expect(step.mock.calls).toEqual([[1], [-1]]);
    expect(b.focusFilter).not.toHaveBeenCalled();
  });

  it("leaves find to the browser pane when the page, or its find field, has the keys", () => {
    const open = vi.fn();
    const off = onThreadFind(open);
    const b = bridge({ cardOpen: true, threadOpen: true });
    runMenuAction("find", "pane", b);
    const field = document.createElement("input");
    const box = document.createElement("div");
    box.setAttribute("data-pane-find", "");
    box.append(field);
    document.body.append(box);
    field.focus();
    runMenuAction("find", undefined, b);
    box.remove();
    off();
    expect(open).not.toHaveBeenCalled();
  });

  it("opens a listed card, selects an unlisted id, and ignores a missing one", () => {
    const b = bridge();
    runMenuAction("open-card", "a", b);
    expect(b.openCard).toHaveBeenCalledWith(b.cards[0]);
    runMenuAction("open-card", "copilot", b);
    expect(b.select).toHaveBeenCalledWith("copilot");
    runMenuAction("open-card", undefined, b);
    expect(b.select).toHaveBeenCalledTimes(1);
    expect(b.openCard).toHaveBeenCalledTimes(1);
  });

  it("opens the webhooks drawer on the thread's ask", () => {
    const b = bridge();
    runMenuAction("add-webhook", JSON.stringify({ folder: "/r", id: "w1" }), b);
    expect(mocks.addWebhookAsk).toHaveBeenCalledWith(b.openDrawer, expect.objectContaining({ folder: "/r", id: "w1" }));
  });

  it("opens the 🔐 drawer on a weft://secrets link's repo", () => {
    const b = bridge();
    runMenuAction("open-secrets", JSON.stringify({ repo: "aimhuge/weft", share: true }), b);
    expect(b.openDrawer).toHaveBeenCalledWith("vault");
  });

  it("opens Settings when the 🔐 drawer asks for Settings → Secrets", () => {
    const b = bridge();
    const { unmount } = renderHook(() => useMenuBridge(b));
    window.dispatchEvent(new Event("weft:open-settings"));
    expect(b.openSettings).toHaveBeenCalled();
    unmount();
  });

  it("ignores an action it doesn't know", () => {
    const b = bridge();
    runMenuAction("nope" as MenuAction, undefined, b);
    for (const fn of [b.openNew, b.openCard, b.select, b.openSettings, b.focusFilter, b.toggleTerminal, b.openDrawer]) expect(fn).not.toHaveBeenCalled();
  });
});

describe("useMenuBridge", () => {
  it("subscribes once and runs actions against the latest bridge, unsubscribing on unmount", () => {
    let listener: ((action: MenuAction, payload?: string) => void) | undefined;
    const off = vi.fn();
    const onMenu = vi.fn((cb: typeof listener) => ((listener = cb), off));
    window.weft = { onMenu } as unknown as ShellBridge;
    const first = bridge();
    const { rerender, unmount } = renderHook((b: MenuBridge) => useMenuBridge(b), { initialProps: first });
    const second = bridge();
    rerender(second);
    listener?.("new-thread");
    expect(first.openNew).not.toHaveBeenCalled();
    expect(second.openNew).toHaveBeenCalledTimes(1);
    expect(onMenu).toHaveBeenCalledTimes(1);
    unmount();
    expect(off).toHaveBeenCalled();
  });

  it("does nothing outside the desktop app", () => {
    const { unmount } = renderHook(() => useMenuBridge(bridge()));
    unmount();
  });
});
