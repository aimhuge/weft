// @vitest-environment jsdom
// A tool row's file (components/ToolLine.tsx): a button that opens it in the editor where the thread links files
// (FileLinkContext, set by ThreadView when the host lists the card's files), plain text where it doesn't (weft.zip).
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ThreadItem } from "@/lib/types";
import { FileLinkContext } from "./file-link-context";
import ToolLine from "./ToolLine";
import "./test-utils";

const openFile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/open-file", () => ({ openFile }));

const item = { kind: "tool", id: "t1", name: "Edit", summary: "turn.ts", file: "lib/turn.ts", result: "ok", at: 1, edit: { added: 1, removed: 0, lines: [] } } as unknown as Extract<ThreadItem, { kind: "tool" }>;

describe("ToolLine's file", () => {
  it("opens the file's diff where the thread links files", () => {
    render(
      <FileLinkContext.Provider value="c1">
        <ToolLine item={item} live={false} cardId="c1" />
      </FileLinkContext.Provider>,
    );
    fireEvent.click(screen.getByTestId("tool-open-file"));
    expect(openFile).toHaveBeenCalledWith({ cardId: "c1", path: "lib/turn.ts", diff: true });
  });

  it("is plain text, with no Open diff, where nothing can open it", () => {
    render(<ToolLine item={item} live={false} cardId="c1" />);
    expect(screen.queryByTestId("tool-open-file")).toBeNull();
    expect(screen.queryByTestId("tool-open-diff")).toBeNull();
    expect(screen.getByText("turn.ts")).toBeInTheDocument();
  });
});
