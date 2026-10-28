// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NewThreadDefaults from "./NewThreadDefaults";
import { openModels, pickModel } from "./model-picker-test-utils";
import "./test-utils";

// localStorage is empty, so modelFor() returns "" for each backend: there is no default model,
// and the CLI picks its own until the user picks one.
describe("NewThreadDefaults", () => {
  it("shows one CLI-and-model menu and the effort, on the model the CLI runs", () => {
    render(<NewThreadDefaults backend="claude" onBackend={() => {}} />);
    expect(screen.queryByRole("combobox", { name: "Default CLI" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Default model" })).toHaveValue("Fable 5.1");
    expect(screen.getByRole("combobox", { name: "Default effort" })).toHaveValue("high");
  });

  it("offers every CLI's models, since picking one moves the CLI to it", () => {
    const { rerender } = render(<NewThreadDefaults backend="puku" onBackend={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Default model" })).toHaveValue("Opus 4.8");

    rerender(<NewThreadDefaults backend="codex" onBackend={() => {}} />);
    // Codex's model lives in its own config, so its row names that model.
    expect(screen.getByRole("combobox", { name: "Default model" })).toHaveValue("Codex’s configured model");

    const list = openModels("Default model");
    expect(within(list).getByRole("group", { name: "Claude Code" })).toBeInTheDocument();
    expect(within(list).getByRole("group", { name: "puku-cli" })).toBeInTheDocument();
    expect(within(list).getByRole("group", { name: /^Codex/ })).toBeInTheDocument();
  });

  it("picks the CLI from its configured-model row, or by picking one of its models", () => {
    const onBackend = vi.fn();
    render(<NewThreadDefaults backend="claude" onBackend={onBackend} />);
    pickModel("Default model", "Codex’s configured model");
    expect(onBackend).toHaveBeenCalledWith("codex");
    pickModel("Default model", "Opus 4.8");
    expect(onBackend).toHaveBeenLastCalledWith("puku");
    // No "the CLI chooses" row left to pick: the count is the two picks above.
    expect(onBackend).toHaveBeenCalledTimes(2);
  });
});
