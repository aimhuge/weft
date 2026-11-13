// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";

const prompt = vi.hoisted(() => ({ useStarPrompt: vi.fn(), starWeft: vi.fn() }));
vi.mock("@/lib/use-star-prompt", () => prompt);

const openExternal = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/desktop", () => ({ openExternal }));

const { default: StarPrompt, StarPromptDialog } = await import("./StarPrompt");

const URL_ = "https://github.com/aimhuge/weft";

function setup(gh: boolean, star = vi.fn().mockResolvedValue(true)) {
  const onLater = vi.fn();
  const onDone = vi.fn();
  render(<StarPromptDialog finished={12} gh={gh} onLater={onLater} onDone={onDone} star={star} />);
  return { onLater, onDone, star };
}

beforeEach(() => vi.clearAllMocks());

describe("StarPromptDialog", () => {
  it("asks, counting the threads you've finished", () => {
    setup(true);
    expect(screen.getByText("⭐ Enjoying Weft?")).toBeInTheDocument();
    expect(screen.getByText(/finished 12 threads/)).toBeInTheDocument();
  });

  it("stars through gh and thanks you", async () => {
    const { onDone, star } = setup(true);
    await userEvent.click(screen.getByRole("button", { name: "Star aimhuge/weft" }));
    expect(star).toHaveBeenCalled();
    expect(await screen.findByText("⭐ Thank you")).toBeInTheDocument();
    expect(openExternal).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Back to work" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("opens the page when gh fails", async () => {
    const { onDone } = setup(true, vi.fn().mockResolvedValue(false));
    await userEvent.click(screen.getByRole("button", { name: "Star aimhuge/weft" }));
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith(URL_));
    expect(onDone).toHaveBeenCalled();
  });

  it("opens the page right away without gh", async () => {
    const { onDone, star } = setup(false);
    await userEvent.click(screen.getByRole("button", { name: "Star on GitHub" }));
    expect(star).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith(URL_);
    expect(onDone).toHaveBeenCalled();
  });

  it("Later snoozes, Don't ask again ends it", async () => {
    const { onLater, onDone } = setup(true);
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onLater).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Don't ask again" }));
    expect(onDone).toHaveBeenCalled();
  });
});

describe("StarPrompt", () => {
  it("renders nothing until the hook opens it", () => {
    prompt.useStarPrompt.mockReturnValue({ open: null, later: vi.fn(), done: vi.fn() });
    const { container } = render(<StarPrompt cards={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("passes the finished count and opens the dialog", () => {
    prompt.useStarPrompt.mockReturnValue({ open: { gh: true }, later: vi.fn(), done: vi.fn() });
    render(<StarPrompt cards={[makeCard({ id: "a", column: "done" }), makeCard({ id: "b", column: "running" })]} />);
    expect(prompt.useStarPrompt).toHaveBeenCalledWith(1);
    expect(screen.getByText(/finished 1 threads/)).toBeInTheDocument();
  });
});
