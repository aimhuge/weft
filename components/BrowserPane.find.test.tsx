// @vitest-environment jsdom
// The browser pane's toolbar: ⌘F on the page swaps the address bar for the find bar, and the
// address bar searches the web for words (its placeholder says so).
import "./test-utils";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserState } from "@/lib/client";

vi.mock("@/lib/use-mini-apps", () => ({ useMiniApps: () => [] }));
vi.mock("./SaveAppButton", () => ({ default: () => null }));
vi.mock("./AppShareButton", () => ({ default: () => null }));
vi.mock("./ZoomMenu", () => ({ default: () => null }));

import BrowserPane from "./BrowserPane";

let openFind: () => void = () => {};
const browser = {
  setBounds: vi.fn(),
  open: vi.fn(),
  find: vi.fn(),
  stopFind: vi.fn(),
  onFound: vi.fn(() => () => {}),
  onFind: vi.fn((cb: () => void) => ((openFind = cb), () => {})),
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(window, { weft: { browser } });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

function setup(url = "https://a.co") {
  const state = { url, title: "", loading: false, canGoBack: false, canGoForward: false, visible: true } as BrowserState;
  return render(<BrowserPane desktop state={state} obscured={false} expanded={false} width={500} onWidth={vi.fn()} onClose={vi.fn()} />);
}

describe("BrowserPane find", () => {
  it("swaps the address bar for the find bar on ⌘F, and back when it closes", () => {
    setup();
    expect(screen.getByPlaceholderText("Search or type a URL")).toBeInTheDocument();
    act(() => openFind());
    expect(screen.getByLabelText("Find in page")).toHaveFocus();
    expect(screen.queryByPlaceholderText("Search or type a URL")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Close find"));
    expect(screen.getByPlaceholderText("Search or type a URL")).toBeInTheDocument();
  });

  it("keeps the address bar with no page open", () => {
    setup("");
    act(() => openFind());
    expect(screen.queryByLabelText("Find in page")).not.toBeInTheDocument();
  });

  it("sends what was typed in the address bar to the shell", () => {
    setup();
    const field = screen.getByPlaceholderText("Search or type a URL");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "react hooks" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(browser.open).toHaveBeenCalledWith("react hooks");
  });
});
