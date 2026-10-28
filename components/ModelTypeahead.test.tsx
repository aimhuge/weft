// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { modelGroups } from "@/lib/model-options";
import ModelTypeahead from "./ModelTypeahead";
import "./test-utils";

// The model picker's own behaviour: the list opens, a pick closes it, and a pick inside a <label>
// doesn't reopen it (a label focuses its input, which opened the list again right after a pick).
//
// The rows come from lib/model-options.ts, so the groups here are the real ones.

const groups = modelGroups();

describe("ModelTypeahead", () => {
  it("opens the list and picks a model, closing the list", async () => {
    const onChange = vi.fn();
    render(<ModelTypeahead value="" groups={groups} onChange={onChange} label="Model" />);
    const field = screen.getByRole("combobox", { name: "Model" });
    await userEvent.click(field);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("option", { name: /Fable 5\.1/ }));
    expect(onChange).toHaveBeenCalledWith("claude-fable-5-1");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("stays closed after a pick when the field sits inside a label", async () => {
    // A click inside a <label> focuses the label's input, which reopens the list right after the
    // pick — the field was left open every time, which is what the card asked us to fix.
    const onChange = vi.fn();
    render(
      <label>
        Model
        <ModelTypeahead value="" groups={groups} onChange={onChange} label="Model" />
      </label>,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Model" }));
    await userEvent.click(screen.getByRole("option", { name: /Fable 5\.1/ }));
    expect(onChange).toHaveBeenCalledWith("claude-fable-5-1");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("finds a model by its id, which is how it is written in a card's header", async () => {
    render(<ModelTypeahead value="" groups={groups} onChange={vi.fn()} label="Model" />);
    const field = screen.getByRole("combobox", { name: "Model" });
    await userEvent.click(field);
    await userEvent.type(field, "opus-4.8");
    expect(screen.getByRole("option", { name: /Opus 4\.8/ })).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    render(<ModelTypeahead value="" groups={groups} onChange={vi.fn()} label="Model" />);
    const field = screen.getByRole("combobox", { name: "Model" });
    await userEvent.click(field);
    await userEvent.type(field, "zzzz");
    expect(screen.getByText(/No model matches/)).toBeInTheDocument();
  });
});
