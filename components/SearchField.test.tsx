// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import "./test-utils";
import SearchField from "./SearchField";

function Harness({ onEnter, onOuterKey }: { onEnter?: () => void; onOuterKey?: () => void }) {
  const [query, setQuery] = useState("");
  return (
    <div onKeyDown={onOuterKey}>
      <SearchField query={query} onQuery={setQuery} label="Filter things" onEnter={onEnter} autoFocus />
    </div>
  );
}

describe("SearchField", () => {
  it("is labelled, focused, and types into the query", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Filter things");
    expect(input).toHaveFocus();
    await userEvent.type(input, "weft");
    expect(input).toHaveValue("weft");
  });

  it("clears on Escape without letting it out, then lets an empty box's Escape through", async () => {
    const outer = vi.fn();
    render(<Harness onOuterKey={outer} />);
    const input = screen.getByLabelText("Filter things");
    await userEvent.type(input, "x{Escape}");
    expect(input).toHaveValue("");
    expect(outer).toHaveBeenCalledTimes(1); // only the "x" keystroke
    await userEvent.keyboard("{Escape}");
    expect(outer).toHaveBeenCalledTimes(2);
  });

  it("calls onEnter on Enter", async () => {
    const enter = vi.fn();
    render(<Harness onEnter={enter} />);
    await userEvent.type(screen.getByLabelText("Filter things"), "a{Enter}");
    expect(enter).toHaveBeenCalledTimes(1);
  });
});
