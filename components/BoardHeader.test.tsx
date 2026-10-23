// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { ReactNode } from "react";
import BoardHeader from "./BoardHeader";

type Fn = ReturnType<typeof vi.fn<() => void>>;
interface FlatProps {
  mac: boolean;
  running: number;
  waiting: number;
  browserOpen: boolean;
  terminalOpen: boolean;
  hint: (id: string, fallback: string) => string;
  onToggleBrowser: Fn;
  onToggleTerminal: Fn;
  onShareBoard: Fn;
  onOpenSettings: Fn;
  onOpenNew: Fn;
  restartChip: ReactNode;
  headerBadges: ReactNode;
  copilotButton: ReactNode;
  accountButton: ReactNode;
}

// Renders BoardHeader with the handlers wired and a no-op hint, then asserts the share button
// exposes it in the toolbar (not just behind the avatar). The command palette and the avatar
// menu still have their own entries, so this test only pins the toolbar placement.
// Takes the header's values flat and groups them the way BoardHeader's props do.
function renderHeader(handlers: Partial<FlatProps> = {}) {
  const props: FlatProps = {
    mac: false,
    running: 0,
    waiting: 0,
    browserOpen: false,
    terminalOpen: false,
    hint: (_id: string, fallback: string) => fallback,
    onToggleBrowser: vi.fn(),
    onToggleTerminal: vi.fn(),
    onShareBoard: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenNew: vi.fn(),
    restartChip: null,
    headerBadges: null,
    copilotButton: null,
    accountButton: null,
    ...handlers,
  };
  const { running, waiting, browserOpen, terminalOpen, onToggleBrowser, onToggleTerminal, restartChip, headerBadges, copilotButton, accountButton, ...rest } = props;
  const header = (
    <BoardHeader
      {...rest}
      counts={{ running, waiting }}
      panes={{ browserOpen, terminalOpen, onToggleBrowser, onToggleTerminal }}
      slots={{ restart: restartChip, badges: headerBadges, copilot: copilotButton, account: accountButton }}
    />
  );
  return { ...render(header), props };
}

describe("BoardHeader", () => {
  it("shows the running count, and the need-you count only when there is one", () => {
    const { unmount } = renderHeader({ running: 2, waiting: 0 });
    expect(screen.getByText("2 running")).toBeInTheDocument();
    expect(screen.queryByText(/need/)).toBeNull();
    unmount();
    renderHeader({ running: 1, waiting: 1 });
    expect(screen.getByText(/1 needs you/)).toBeInTheDocument();
  });

  it("lights the browser and terminal buttons while their panes are open", () => {
    renderHeader({ browserOpen: true, terminalOpen: false });
    expect(screen.getByRole("button", { name: "Browser" }).className).toContain("bg-accent-soft");
    expect(screen.getByRole("button", { name: "Terminal" }).className).not.toContain("bg-accent-soft");
  });

  it("wires each toolbar button to its handler", async () => {
    const { props } = renderHeader();
    for (const [name, handler] of [
      ["Browser", props.onToggleBrowser],
      ["Terminal", props.onToggleTerminal],
      ["Settings", props.onOpenSettings],
      ["New thread", props.onOpenNew],
    ] as const) {
      await userEvent.click(screen.getByRole("button", { name }));
      expect(handler).toHaveBeenCalledTimes(1);
    }
  });

  it("draws the four slots Board hands it", () => {
    renderHeader({ restartChip: <i>restart</i>, headerBadges: <i>badges</i>, copilotButton: <i>copilot</i>, accountButton: <i>account</i> });
    for (const text of ["restart", "badges", "copilot", "account"]) expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("exposes a Share the board button that calls onShareBoard", async () => {
    const onShareBoard = vi.fn();
    renderHeader({ onShareBoard });
    const button = screen.getByRole("button", { name: "Share the board" });
    expect(button).toHaveAttribute("title", "Share the board");
    await userEvent.click(button);
    expect(onShareBoard).toHaveBeenCalledTimes(1);
  });
});
