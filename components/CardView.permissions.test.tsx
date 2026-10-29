// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import CardView from "./CardView";
import "./test-utils";

// The permission prompt's ordering choices live here, away from the wide CardView sweep: a clash asks
// "who goes first", not "allow or deny".

const api = vi.hoisted(() => ({
  login: vi.fn(() => Promise.resolve()),
  switchBackend: vi.fn(() => Promise.resolve() as Promise<unknown>),
  clearBreak: vi.fn(() => Promise.resolve()),
  putFirst: vi.fn(() => Promise.resolve()),
  putHolderFirst: vi.fn(() => Promise.resolve()),
  waitPermission: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/client", () => ({ api }));

const pending = { id: "p1", toolName: "Bash", title: "Run npm test", input: {} };

function renderCard(over: Parameters<typeof makeCard>[0] = {}) {
  const handlers = { onOpen: vi.fn(), onAnswer: vi.fn(), onStop: vi.fn() };
  render(<CardView card={makeCard(over)} now={0} selected={false} {...handlers} />);
  return handlers;
}

beforeEach(() => vi.clearAllMocks());

describe("CardView permission order", () => {
  it("an edit another card holds offers the order: Wait, This first and Others first, and no Allow", async () => {
    const why = { holder: { id: "c2", title: "Other", claim: "f.ts" } } as never;
    renderCard({ column: "needs_you", pending: { ...pending, why } });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(expect.arrayContaining(["Wait", "This first", "Others first"]));
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deny" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Wait" }));
    expect(api.waitPermission).toHaveBeenCalledWith(makeCard().id, pending.id);
  });

  it("Others first puts the card holding the code ahead, and this card waits", async () => {
    const why = { holder: { id: "c2", title: "Other", claim: "f.ts" } } as never;
    renderCard({ column: "needs_you", pending: { ...pending, why } });
    await userEvent.click(screen.getByRole("button", { name: "Others first" }));
    expect(api.putHolderFirst).toHaveBeenCalledWith(makeCard().id, pending.id);
  });

  it("a card waiting on another card's code stays in Running, with the holder's face, This first and Others first", async () => {
    const why = { holder: { id: "c2", title: "Other", claim: "f.ts", emoji: "🎨" } } as never;
    const { onAnswer } = renderCard({
      column: "running",
      lastLine: "Waiting for ‘Other’",
      pending: { ...pending, why, waiting: true },
    });
    expect(screen.getByRole("img", { name: "Other" })).toHaveTextContent("🎨");
    expect(screen.queryByRole("button", { name: "Wait" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "This first" }));
    expect(api.putFirst).toHaveBeenCalledWith(makeCard().id, pending.id);
    await userEvent.click(screen.getByRole("button", { name: "Others first" }));
    expect(api.putHolderFirst).toHaveBeenCalledWith(makeCard().id, pending.id);
    expect(onAnswer).not.toHaveBeenCalled();
    // It reads as held, not as working: the amber border, not a spinner.
    expect(screen.getByText("Fix the login page").closest("[data-card-id]")).toHaveClass("border-warn/60");
  });
});
