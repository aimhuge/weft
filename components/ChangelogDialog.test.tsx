// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangelogEntry } from "@/lib/changelog";
import "./test-utils";

// The Changelog dialog (components/ChangelogDialog.tsx): opens from lib/changelog-open.ts, lists Unreleased then each
// version, links each entry to its card, and has no Release step (Weft writes CHANGELOG.md itself). The API is mocked.

const call = vi.hoisted(() => vi.fn());
const selectCard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client", () => ({ call }));
vi.mock("@/lib/onboarding-events", () => ({ selectCard }));
vi.mock("./Markdown", () => ({ default: ({ text }: { text: string }) => <p>{text}</p> }));

const { closeChangelog, openChangelog } = await import("@/lib/changelog-open");
const { default: ChangelogDialog } = await import("./ChangelogDialog");

const entry = (id: string, at: number, extra: Partial<ChangelogEntry> = {}): ChangelogEntry => ({ id, project: "/r/weft", kind: "added", text: `Entry ${id}`, at, ...extra });

afterEach(() => {
  act(() => closeChangelog());
  call.mockReset();
  selectCard.mockReset();
});

describe("ChangelogDialog", () => {
  it("draws nothing until a project's changelog is opened", () => {
    const { container } = render(<ChangelogDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists Unreleased, then versions, with each entry's state and card link", async () => {
    call.mockResolvedValue({
      project: "/r/weft",
      entries: [entry("b", 2, { cardId: "c2", cardTitle: "Fix login", sha: "abcdef12" }), entry("a", 1, { version: "1.0.0", releasedAt: Date.UTC(2026, 9, 1) })],
    });
    render(<ChangelogDialog />);
    act(() => openChangelog("/r/weft"));
    expect(await screen.findByText("Entry b")).toBeInTheDocument();
    expect(call).toHaveBeenCalledWith("GET", "/api/changelog?folder=%2Fr%2Fweft");
    expect(screen.getByText("Changelog · weft")).toBeInTheDocument();
    expect(screen.getByText("Unreleased")).toBeInTheDocument();
    expect(screen.getByText("1.0.0 · 2026-10-01")).toBeInTheDocument();
    expect(screen.getByText("committed abcdef1")).toBeInTheDocument();
    expect(screen.getByText(/Weft commits CHANGELOG.md after each card/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Release" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "↗ Fix login" }));
    expect(selectCard).toHaveBeenCalledWith("c2");
    expect(screen.queryByText("Entry b")).not.toBeInTheDocument();
  });

  it("says when there's nothing yet, and shows a load error", async () => {
    call.mockResolvedValueOnce({ project: "/r/empty", entries: [] });
    render(<ChangelogDialog />);
    act(() => openChangelog("/r/empty"));
    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Weft commits CHANGELOG.md/)).not.toBeInTheDocument();
    call.mockRejectedValueOnce(new Error("offline"));
    act(() => openChangelog("/r/other"));
    expect(await screen.findByText("offline")).toBeInTheDocument();
  });
});
