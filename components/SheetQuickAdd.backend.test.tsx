// @vitest-environment jsdom
// The quick add's default CLI, read from the settings. A settings call that fails falls back to Claude.
// This lives in its own file because the setting is read once per module (components/SheetQuickAdd.tsx keeps
// the promise), so the failure path needs a module that hasn't read it yet.

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SheetQuickAdd from "./SheetQuickAdd";
import "./test-utils";

const api = vi.hoisted(() => ({
  create: vi.fn(() => Promise.resolve({ card: {} })),
  settings: vi.fn(() => Promise.reject(new Error("no settings"))),
}));
vi.mock("@/lib/client", () => ({ api }));

afterEach(cleanup);

describe("SheetQuickAdd's default CLI", () => {
  it("falls back to Claude when the settings can't be read", async () => {
    render(<SheetQuickAdd column="backlog" folders={["/dev/weft"]} focus={false} onMore={vi.fn()} />);
    const box = await waitFor(() => {
      const el = document.querySelector("input");
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    fireEvent.change(box, { target: { value: "A card" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ backend: "claude" })));
  });
});
