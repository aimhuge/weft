// @vitest-environment jsdom
// The footer always shows the given card's info; the terminal drawer shows only while open, keyed by
// its folder. guarded() is stubbed so each piece records its props by `what`.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import { act } from "react";
import { useTerminalDrawer } from "@/lib/use-terminal-drawer";

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

  it("says the terminal isn't there for a worker's card instead of opening a shell on this Mac", () => {
    const t = terminal({ away: "m1mini" });
    render(<BoardBottom footer={footer} onHelp={vi.fn()} terminal={t} />);
    expect(seen.has("terminal")).toBe(false);
    expect(screen.getByText(/isn't available for cards on m1mini/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close terminal"));
    expect(t.onClose).toHaveBeenCalled();
  });

  it("renders nothing of its own around the footer and terminal (no stray text like a debug probe's 'none')", () => {
    const { container } = render(<BoardBottom footer={footer} onHelp={vi.fn()} terminal={terminal({ open: false })} />);
    expect(container.textContent).toBe("");
    expect([...container.children].map((el) => el.getAttribute("data-what"))).toEqual(["footer"]);
  });

  it("doesn't open a worker card's terminal when you switch to it with the drawer open, only when you toggle it there", () => {
    const projects = [{ path: "worker://w1/ling", worker: "m1mini" }] as unknown as Parameters<typeof useTerminalDrawer>[0]["projects"];
    let toggle = () => {};
    function Harness({ cwd }: { cwd: string }) {
      const t = useTerminalDrawer({ cwd, openWorker: null, project: null, projects, cardOpen: true });
      toggle = t.toggle;
      return <BoardBottom footer={footer} onHelp={vi.fn()} terminal={{ open: t.open, cwd, height: t.height, onHeight: t.setHeight, onClose: t.toggle, away: t.away, host: t.host }} />;
    }
    const { rerender } = render(<Harness cwd="/r" />);
    act(() => toggle());
    expect(mounts).toEqual(["/r"]);
    rerender(<Harness cwd="worker://w1/ling" />);
    expect(mounts).toEqual(["/r"]);
    expect(document.querySelector("[data-what=terminal]")).toBeNull();
    act(() => toggle());
    expect(mounts).toEqual(["/r", "worker://w1/ling"]);
    expect(seen.get("terminal")).toMatchObject({ cwd: "worker://w1/ling", host: "m1mini" });
  });
});
