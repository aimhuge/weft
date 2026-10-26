// @vitest-environment jsdom
// The thread header's model picker: every model of every CLI is offered, and picking one moves the
// card to the CLI that serves it.
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import BackendPicker from "./BackendPicker";

const api = vi.hoisted(() => ({
  switchBackend: vi.fn(() => Promise.resolve() as Promise<unknown>),
}));
vi.mock("@/lib/client", () => ({ api }));

beforeEach(() => vi.clearAllMocks());

describe("BackendPicker", () => {
  afterEach(cleanup);

  it("lists each CLI's models, marks the current one, and switches CLI with the picked model", async () => {
    render(<BackendPicker card={makeCard({ backend: "claude", model: "claude-opus-5-5" })} />);
    await userEvent.click(screen.getByRole("button", { name: /Switch model/ }));
    expect(screen.getByRole("button", { name: "Opus 5.5" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Opus 4.8" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("group", { name: "puku-cli" })).toBeInTheDocument();
    // Every CLI runs behind Weft's guards (lib/guards), so no heading carries a warning.
    expect(screen.getByRole("group", { name: "Codex" })).not.toHaveTextContent("guards");
    await userEvent.click(screen.getByRole("button", { name: "Puku AI 2.7" }));
    expect(api.switchBackend).toHaveBeenCalledWith("c1", "puku", false, "puku-ai-2.7");
  });

  it("a puku card left with a Claude model reads as the default — there is no default model", async () => {
    // A model the CLI doesn't serve drops out (the gateway would answer it as a Puku model, so the
    // chip would lie). With no model left, the card runs on whatever its CLI chooses: "Default model".
    render(<BackendPicker card={makeCard({ backend: "puku", model: "claude-fable-5-1" })} />);
    await userEvent.click(screen.getByRole("button", { name: /Switch model/ }));
    expect(screen.getByRole("button", { name: "Default model" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Opus 4.8" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Fable 5.1" })).toHaveAttribute("aria-pressed", "false");
  });

  it("is a no-op when the chosen model is the card's own", async () => {
    render(<BackendPicker card={makeCard({ backend: "puku", model: "puku-ai-2.8" })} />);
    await userEvent.click(screen.getByRole("button", { name: /Switch model/ }));
    await userEvent.click(screen.getByRole("button", { name: "Puku AI 2.8" }));
    expect(api.switchBackend).not.toHaveBeenCalled();
  });

  it("while live, offers every model and says a CLI switch needs the thread stopped", async () => {
    render(<BackendPicker card={makeCard({ backend: "claude", column: "running" })} />);
    await userEvent.click(screen.getByRole("button", { name: /Switch model/ }));
    // Every model is offered: the pick is made, and the server refuses the CLI move while busy.
    expect(screen.getByRole("button", { name: "Sonnet 5.5" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Opus 4.8" })).toBeEnabled();
    expect(screen.getByText("Stop the thread to switch CLI.")).toBeInTheDocument();
  });

  it("refuses a CLI move on a live thread at once, without asking the server", async () => {
    render(<BackendPicker card={makeCard({ backend: "claude", column: "running" })} />);
    await userEvent.click(screen.getByRole("button", { name: /Switch model/ }));
    await userEvent.click(screen.getByRole("button", { name: "Puku AI 2.8" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Stop the thread before switching its CLI.");
    expect(api.switchBackend).not.toHaveBeenCalled();
  });

  it("says why when the server refuses the switch, instead of failing silently", async () => {
    api.switchBackend.mockRejectedValueOnce(new Error("Error: No such card."));
    render(<BackendPicker card={makeCard({ backend: "claude" })} />);
    await userEvent.click(screen.getByRole("button", { name: /Switch model/ }));
    await userEvent.click(screen.getByRole("button", { name: "Puku AI 2.8" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No such card.");
  });

  it("the copilot switches model too, from a menu that opens upward under its reply box", async () => {
    render(<BackendPicker card={makeCard({ id: "copilot", backend: "claude", role: "copilot" })} up />);
    await userEvent.click(screen.getByRole("button", { name: /Switch model/ }));
    expect(screen.getByRole("group", { name: "Default" }).parentElement).toHaveClass("bottom-full");
    await userEvent.click(screen.getByRole("button", { name: "Puku AI 2.8" }));
    expect(api.switchBackend).toHaveBeenCalledWith("copilot", "puku", false, expect.any(String));
  });
});
