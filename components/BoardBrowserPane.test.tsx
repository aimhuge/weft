// @vitest-environment jsdom
// The standalone pane: slid by StandaloneBrowserPane, hidden while sliding or under an overlay, and
// its show rail has no card. guarded() is stubbed so each piece records its props by `what`.

import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserState } from "@/lib/client";

type Props = Record<string, unknown> & { rail?: ReactNode };
const seen = new Map<string, Props>();
let sliding = false;
vi.mock("./guarded", () => ({
  guarded: (_load: unknown, { what }: { what: string }) =>
    function Stub(props: Props) {
      seen.set(what, props);
      return <div>{props.rail}</div>;
    },
}));
vi.mock("./StandaloneBrowserPane", () => ({
  default: (p: { open: boolean; width: number; children: (sliding: boolean) => ReactNode }) => {
    seen.set("slide", p);
    return <>{p.children(sliding)}</>;
  },
}));

import BoardBrowserPane, { type BoardBrowserPaneProps } from "./BoardBrowserPane";

afterEach(() => {
  cleanup();
  seen.clear();
  sliding = false;
});

function setup(over: Partial<BoardBrowserPaneProps> = {}) {
  const props: BoardBrowserPaneProps = {
    open: true,
    desktop: true,
    state: { url: "http://x" } as BrowserState,
    width: 560,
    onWidth: vi.fn(),
    obscured: false,
    onClose: vi.fn(),
    items: [],
    ...over,
  };
  render(<BoardBrowserPane {...props} />);
  return props;
}

describe("BoardBrowserPane", () => {
  it("slides at its width and wires the pane", () => {
    const p = setup();
    expect(seen.get("slide")).toMatchObject({ open: true, width: 560 });
    expect(seen.get("browser pane")).toMatchObject({ desktop: true, state: p.state, width: 560, onWidth: p.onWidth, onClose: p.onClose, expanded: false, obscured: false });
    expect(seen.get("show rail")).toMatchObject({ card: null, hidden: false, items: p.items, pageUrl: "http://x" });
  });

  it("hides the page while sliding in or under an overlay", () => {
    sliding = true;
    setup();
    expect(seen.get("browser pane")!.obscured).toBe(true);
    cleanup();
    sliding = false;
    setup({ obscured: true });
    expect(seen.get("browser pane")!.obscured).toBe(true);
  });
});
