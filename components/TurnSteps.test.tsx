// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import "./test-utils";
import { FindRevealContext, type FindReveal } from "@/lib/find-reveal";
import type { ToolsEntry } from "@/lib/turn-steps";
import type { ThreadItem } from "@/lib/types";
import { ThreadEntries, groupThread } from "./ThreadItems";
import TurnSteps from "./TurnSteps";

type ToolCall = Extract<ThreadItem, { kind: "tool" }>;

const tool = (id: string, over: Partial<ToolCall> = {}): ToolCall => ({ kind: "tool", id, name: "Bash", summary: `echo ${id}`, at: 1, result: "ok", ...over });
const thread: ThreadItem[] = [
  { kind: "user", id: "u", text: "go", at: 1 },
  tool("a"),
  tool("b", { isError: true }),
  { kind: "assistant", text: "Halfway there.", at: 1 },
  tool("c", { images: ["https://example.com/shot.png"] }),
];

const setCookie = (cookie: string) => {
  document.cookie = cookie;
};

afterEach(() => {
  setCookie("weft-board-mode=; path=/; max-age=0");
  setCookie("weft-simple-fold-turn-steps=; path=/; max-age=0");
});

describe("ThreadEntries with fold-turn-steps", () => {
  it("draws a turn's runs as one line in simple mode, with its prose and screenshots still showing", async () => {
    setCookie("weft-board-mode=regular; path=/");
    const { container } = render(<ThreadEntries entries={groupThread(thread)} live={false} streaming="" cardId="c1" />);
    const line = screen.getByRole("button", { name: /Weft ran 3 steps/ });
    expect(line).toHaveTextContent("· 1 failed");
    expect(line).toHaveAttribute("title", "Ran 3 commands");
    expect(screen.getByText("Halfway there.")).toBeTruthy();
    expect(screen.getByAltText("Screenshot")).toBeTruthy();
    expect(screen.queryByText(/Ran 2 commands/)).toBeNull();

    await userEvent.click(line);
    expect(line).toHaveAttribute("aria-expanded", "true");
    // The runs come back as they are without the fold, and the second keeps its own row for find.
    expect(screen.getByText(/Ran 2 commands/)).toBeTruthy();
    expect(screen.getByText(/Ran a command/)).toBeTruthy();
    expect(container.querySelector('[data-turn="t4"]')).toBeTruthy();
  });

  it("draws run by run in advanced mode, and when the piece is switched off", () => {
    render(<ThreadEntries entries={groupThread(thread)} live={false} streaming="" cardId="c1" />);
    expect(screen.queryByText(/Weft ran/)).toBeNull();
    expect(screen.getByText(/Ran 2 commands/)).toBeTruthy();

    setCookie("weft-board-mode=regular; path=/");
    setCookie("weft-simple-fold-turn-steps=0; path=/");
    render(<ThreadEntries entries={groupThread(thread)} live={false} streaming="" cardId="c2" />);
    expect(screen.queryByText(/Weft ran/)).toBeNull();
  });
});

describe("TurnSteps", () => {
  const runs = groupThread(thread).flatMap((e) => (e.kind === "tools" ? [e] : []));

  it("spins and names the running call while the turn is live", () => {
    const live = [...runs, { kind: "tools" as const, calls: [tool("d", { result: undefined, summary: "pnpm test" })], key: 9 }];
    const { container } = render(<TurnSteps runs={live} live cardId="c1" />);
    expect(screen.getByRole("button", { name: /Weft ran 4 steps/ })).toBeTruthy();
    expect(screen.getByText(/pnpm test/)).toBeTruthy();
    expect(container.querySelector(".animate-spin, [role=status], svg")).toBeTruthy();
  });

  it("opens while find's current match is inside it, and says denials", () => {
    const denied: Extract<ThreadItem, { kind: "permission" }> = { kind: "permission", id: "p", toolName: "Bash", title: "Run rm", decision: "deny", at: 1 };
    const [first, second] = runs as [ToolsEntry, ToolsEntry];
    const withDenial = [{ ...first, calls: [...first.calls, denied] }, second];
    render(
      <FindRevealContext.Provider value={second.calls[0] as FindReveal}>
        <TurnSteps runs={withDenial} live={false} cardId="c1" />
      </FindRevealContext.Provider>,
    );
    const line = screen.getByRole("button", { name: /Weft ran 3 steps/ });
    expect(line).toHaveAttribute("aria-expanded", "true");
    expect(line).toHaveTextContent("· 1 denied");
  });
});
