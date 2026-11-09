// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PileBadge from "./PileBadge";

const PILE = { root: "/dev/app", files: 3, added: 12, removed: 4, cards: 2 };

function respond(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body)));
}

let fetchMock: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;
beforeEach(() => {
  fetchMock = vi.fn((url: string) => respond(url.includes("prompt=1") ? { pile: PILE, prompt: "Walk me through", title: "Commit the pile" } : { pile: PILE }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(cwd: string | null = "/dev/app") {
  const onStart = vi.fn<(cwd: string, prompt: string, title: string) => Promise<string | undefined>>(() => Promise.resolve("card-1"));
  const onError = vi.fn();
  const view = render(<PileBadge cwd={cwd} onStart={onStart} onError={onError} />);
  return { onStart, onError, view };
}

describe("PileBadge", () => {
  it("shows the folder's uncommitted lines", async () => {
    setup();
    expect(await screen.findByText("+12")).toBeTruthy();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/pile?cwd=%2Fdev%2Fapp");
  });

  it("pitches the review on hover, with the count of cards to review", async () => {
    setup();
    await userEvent.hover(await screen.findByText("+12"));
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("Uncommitted: 12 new lines of code, -4 removed");
    expect(tip.textContent).toContain("Review 2 cards");
  });

  it("shows nothing for a clean tree or no folder", async () => {
    fetchMock.mockImplementation(() => respond({ pile: null }));
    const { view } = setup();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(view.container.textContent).toBe("");
    view.unmount();
    fetchMock.mockClear();
    setup(null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts nothing when the badge itself is clicked", async () => {
    const { onStart } = setup();
    await userEvent.click(await screen.findByText("+12"));
    await new Promise((r) => setTimeout(r, 20));
    expect(onStart).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => url.includes("prompt=1"))).toBe(false);
  });

  it("starts the walk-through from the bubble's own button", async () => {
    const { onStart } = setup();
    await userEvent.hover(await screen.findByText("+12"));
    await userEvent.click(screen.getByRole("button", { name: "Review 2 cards" }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith("/dev/app", "Walk me through", "Commit the pile"));
  });

  it("reports an error when there is no prompt to start", async () => {
    const { onStart, onError } = setup();
    await userEvent.hover(await screen.findByText("+12"));
    fetchMock.mockImplementation(() => respond({ error: "boom" }));
    await userEvent.click(screen.getByRole("button", { name: "Review 2 cards" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(new Error("boom")));
    expect(onStart).not.toHaveBeenCalled();
  });
});
