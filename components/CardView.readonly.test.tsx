// @vitest-environment jsdom
// CardView as the weft.zip board draws it (readOnly): what the card says stays, every control that acts on it goes.
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import CardView from "./CardView";

vi.mock("@/lib/client", () => ({ api: { login: vi.fn(), switchBackend: vi.fn() } }));

const pending = { id: "p1", toolName: "Bash", title: "Run npm test", input: {} };

function renderCard(over: Parameters<typeof makeCard>[0] = {}, props: Partial<Parameters<typeof CardView>[0]> = {}) {
  const onOpen = vi.fn();
  render(<CardView card={makeCard(over)} now={0} selected={false} readOnly onOpen={onOpen} {...props} />);
  return { onOpen };
}

afterEach(cleanup);

describe("CardView read-only", () => {
  it("keeps what the card says and drops every control that acts on it", () => {
    const onResume = vi.fn();
    renderCard(
      { column: "needs_you", lastLine: "Run npm test?", pending, sessionId: "s1", rateLimitHit: true, error: "limit" },
      { onResume, onStar: vi.fn(), onArchive: vi.fn() },
    );
    expect(screen.getByText("Fix the login page")).toBeInTheDocument();
    for (const name of ["Allow", "Deny", "Continue", "Restart", "Stop this thread", /Run on/, /star/i, /archive/i, "Log in", "Answer"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(document.querySelector("[draggable=true]")).toBeNull();
  });

  it("a done card has no archive button, a login wait has no Log in", () => {
    renderCard({ column: "done" }, { onArchive: vi.fn() });
    expect(screen.queryByLabelText(/archive/i)).not.toBeInTheDocument();
  });

  it("a teammate's card says whose it is where the buttons would be", () => {
    renderCard({ team: { org: "o", owner: "z", name: "Zulker Nayeen", avatar: "https://a/z.png", device: "d" } }, { onStar: vi.fn() });
    expect(screen.getByText("Zulker's Mac")).toBeInTheDocument();
    expect(document.querySelector('img[src="https://a/z.png"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: /star/i })).not.toBeInTheDocument();
  });

  it("still opens the thread on click", async () => {
    const { onOpen } = renderCard();
    await userEvent.click(screen.getByText("Fix the login page"));
    expect(onOpen).toHaveBeenCalled();
  });
});

