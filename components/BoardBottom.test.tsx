// @vitest-environment jsdom
// The footer always shows the given card's info; the terminal drawer shows only while open, keyed by
// its folder. guarded() is stubbed so each piece records its props by `what`.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Props = Record<string, unknown>;
const seen = new Map<string, Props>();
const mounts: string[] = [];
vi.mock("./guarded", () => ({
  guarded: (_load: unknown, { what }: { what: string }) =>
    function Stub(props: Props) {
      seen.set(what, props);
      if (what === "terminal") mounts.push(props.cwd as string);
      return <div data-what={what} />;
    },
}));

import BoardBottom, { type BoardBottomProps } from "./BoardBottom";

afterEach(() => {
  cleanup();
  seen.clear();
  mounts.length = 0;
});

const footer = { stats: undefined, cwd: "/r", backend: "claude" } as BoardBottomProps["footer"];
const terminal = (over: Partial<BoardBottomProps["terminal"]> = {}) => ({ open: true, cwd: "/r", height: 240, onHeight: vi.fn(), onClose: vi.fn(), ...over });

describe("BoardBottom", () => {
  it("shows the footer and no terminal while it's closed", () => {
    const onHelp = vi.fn();
    render(<BoardBottom footer={footer} onHelp={onHelp} terminal={terminal({ open: false })} />);
    expect(seen.get("footer")).toMatchObject({ cwd: "/r", backend: "claude", onHelp });
    expect(seen.has("terminal")).toBe(false);
  });

  it("shows the terminal while open, and starts a new one for another folder", () => {
    const t = terminal();
    const { rerender } = render(<BoardBottom footer={footer} onHelp={vi.fn()} terminal={t} />);
    expect(seen.get("terminal")).toMatchObject({ cwd: "/r", height: 240, onHeight: t.onHeight, onClose: t.onClose });
    rerender(<BoardBottom footer={footer} onHelp={vi.fn()} terminal={terminal({ cwd: "/other" })} />);
    expect(mounts).toEqual(["/r", "/other"]);
  });

  it("renders nothing of its own around the footer and terminal (no stray text like a debug probe's 'none')", () => {
    const { container } = render(<BoardBottom footer={footer} onHelp={vi.fn()} terminal={terminal({ open: false })} />);
    expect(container.textContent).toBe("");
    expect([...container.children].map((el) => el.getAttribute("data-what"))).toEqual(["footer"]);
  });
});
