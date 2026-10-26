// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import NewThreadDefaults from "./NewThreadDefaults";
import "./test-utils";

// localStorage is empty, so modelFor() returns "" for each backend: there is no default model,
// and the CLI picks its own until the user picks one.
describe("NewThreadDefaults", () => {
  it("shows one CLI-and-model menu and the effort, on the CLI's own default", () => {
    render(<NewThreadDefaults backend="claude" onBackend={() => {}} />);
    expect(screen.queryByRole("combobox", { name: "Default CLI" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Default model" })).toHaveValue("cli:claude");
    expect(screen.getByRole("combobox", { name: "Default effort" })).toHaveValue("high");
  });

  it("offers every CLI's models, since picking one moves the CLI to it", () => {
    const { rerender } = render(<NewThreadDefaults backend="claude" onBackend={() => {}} />);
    expect(screen.getByRole("group", { name: "Claude Code" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "puku-cli" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Codex · no Weft guards" })).toBeInTheDocument();

    rerender(<NewThreadDefaults backend="puku" onBackend={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Default model" })).toHaveValue("cli:puku");

    rerender(<NewThreadDefaults backend="codex" onBackend={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Default model" })).toHaveValue("cli:codex");
  });

  it("picks the CLI from its default row, or by picking one of its models", async () => {
    const onBackend = vi.fn();
    render(<NewThreadDefaults backend="claude" onBackend={onBackend} />);
    const menu = screen.getByRole("combobox", { name: "Default model" });
    await userEvent.selectOptions(menu, "cli:codex");
    expect(onBackend).toHaveBeenCalledWith("codex");
    await userEvent.selectOptions(menu, "opus-4.8");
    expect(onBackend).toHaveBeenLastCalledWith("puku");
    await userEvent.selectOptions(menu, "cli:claude");
    expect(onBackend).toHaveBeenCalledTimes(2);
  });
});
