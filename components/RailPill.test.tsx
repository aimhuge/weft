// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { railOpen, setRailOpen } from "@/lib/pane-rail-open";
import type { ThreadItem } from "@/lib/types";
import { makeCard } from "./test-utils";
import RailPill from "./RailPill";

afterEach(() => act(() => setRailOpen(false)));

const items: ThreadItem[] = [
  { kind: "user", text: "Build it", at: 1 },
  { kind: "assistant", text: "Done.", at: 2 },
];

describe("RailPill", () => {
  it("counts the rail's minis and toggles the rail open and folded", () => {
    render(<RailPill card={makeCard()} items={items} />);
    const pill = screen.getByRole("button", { name: "Open the show rail (2)" });
    expect(pill).toHaveTextContent("⧉ 2");
    expect(pill).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(pill);
    expect(railOpen()).toBe(true);
    expect(screen.getByRole("button", { name: "Fold the show rail" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Fold the show rail" }));
    expect(railOpen()).toBe(false);
  });
});
