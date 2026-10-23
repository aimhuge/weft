// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import NewThreadDefaults from "./NewThreadDefaults";
import "./test-utils";

// localStorage is empty, so modelFor() returns "" for each backend: there is no default model,
// and the CLI picks its own until the user picks one.
describe("NewThreadDefaults", () => {
  it("shows the CLI, model and effort pickers with no model of their own", () => {
    render(<NewThreadDefaults backend="claude" onBackend={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Default CLI" })).toHaveValue("claude");
    expect(screen.getByRole("combobox", { name: "Default model" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Default effort" })).toHaveValue("high");
  });

  it("offers every CLI's models, since picking one moves the CLI to it", () => {
    const { rerender } = render(<NewThreadDefaults backend="claude" onBackend={() => {}} />);
    expect(screen.getByRole("group", { name: "Claude" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Puku" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Codex" })).toBeInTheDocument();

    rerender(<NewThreadDefaults backend="puku" onBackend={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Default model" })).toHaveValue("");

    rerender(<NewThreadDefaults backend="codex" onBackend={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Default model" })).toHaveValue("");
  });

  it("forwards a new backend pick", async () => {
    const onBackend = vi.fn();
    render(<NewThreadDefaults backend="claude" onBackend={onBackend} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Default CLI" }), "codex");
    expect(onBackend).toHaveBeenCalledWith("codex");
  });
});
