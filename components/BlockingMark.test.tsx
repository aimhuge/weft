// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Card } from "@/lib/types";
import { publishWaits } from "@/lib/waits-on";
import BlockingMark from "./BlockingMark";
import "./test-utils";

function card(id: string, over: Partial<Card> = {}): Card {
  return { id, title: id, prompt: "", cwd: "/repo", backend: "claude", permissionMode: "default", column: "running", createdAt: 0, updatedAt: 0, ...over };
}

const waiting = (id: string, holderId: string) =>
  card(id, {
    pending: { id: `p-${id}`, toolName: "Edit", title: "t", input: {}, waiting: true, why: { category: "same-code", detail: "d", holder: { id: holderId, title: holderId, claim: "/repo/Login.tsx#Form" } } },
  });

describe("BlockingMark", () => {
  it("shows nothing when no card waits on this one", () => {
    publishWaits([]);
    const { container } = render(<BlockingMark cardId="h" />);
    expect(container.textContent).toBe("");
  });

  it("stamps how many cards it is holding up", () => {
    act(() => publishWaits([waiting("a", "h"), waiting("b", "h")]));
    render(<BlockingMark cardId="h" />);
    expect(screen.getByLabelText("Blocking 2 cards")).toBeTruthy();
    expect(screen.getByText(/blocking 2/)).toBeTruthy();
    act(() => publishWaits([]));
  });

  it("drops the stamp when the waiters are released", () => {
    act(() => publishWaits([waiting("a", "h")]));
    const { container } = render(<BlockingMark cardId="h" />);
    expect(container.textContent).not.toBe("");
    act(() => publishWaits([]));
    expect(container.textContent).toBe("");
  });
});
