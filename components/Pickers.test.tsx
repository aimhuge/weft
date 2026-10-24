// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BACKENDS, MODELS } from "@/lib/new-thread";
import { BackendPicker, EffortPicker, ModelPicker } from "./Pickers";
import "./test-utils";

describe("ModelPicker", () => {
  it("groups Claude, Puku and Codex by default and skips empty groups", () => {
    render(<ModelPicker value="claude-opus-5-5" onChange={() => {}} label="Model" />);
    expect(screen.getByRole("group", { name: "Claude" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Puku" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Codex" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Codex default" })).toBeInTheDocument();
  });

  it("offers every model of every CLI — no per-row lock", () => {
    render(<ModelPicker value="claude-opus-5-5" onChange={() => {}} label="Model" />);
    // A Puku and a Codex model are both there: picking one moves that row's CLI to the one
    // that serves it, so no row is limited to one CLI.
    expect(screen.getByRole("option", { name: "Puku AI 2.8" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Opus 4.8" })).toBeInTheDocument();
  });

  it("forwards the picked value", async () => {
    const onChange = vi.fn();
    render(<ModelPicker value="claude-opus-5-5" onChange={onChange} label="Model" />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Model" }), "opus-4.8");
    expect(onChange).toHaveBeenCalledWith("opus-4.8");
  });

  it("renders the leading options first, then the groups", () => {
    render(
      <ModelPicker
        value=""
        onChange={() => {}}
        label="Model"
        leading={[{ value: "", label: "Card's own model" }]}
      />,
    );
    const opts = screen.getAllByRole("option");
    expect(opts[0]).toHaveTextContent("Card's own model");
    // The Claude group follows.
    const claudeGroup = screen.getByRole("group", { name: "Claude" });
    expect(claudeGroup.children[0]).toHaveTextContent(MODELS.claude[0]!.label);
  });
});

describe("BackendPicker", () => {
  it("lists every backend by default", () => {
    render(<BackendPicker value="claude" onChange={() => {}} label="CLI" />);
    BACKENDS.forEach((b) => {
      expect(screen.getByRole("option", { name: b.label })).toBeInTheDocument();
    });
  });

  it("filters to a subset when `available` is given", () => {
    render(<BackendPicker value="claude" onChange={() => {}} label="CLI" available={["claude", "puku"]} />);
    expect(screen.queryByRole("option", { name: "Codex" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Claude Code" })).toBeInTheDocument();
  });
});

describe("EffortPicker", () => {
  it("starts with a default-effort leading option", () => {
    render(<EffortPicker value="" onChange={() => {}} label="Effort" />);
    expect(screen.getByRole("option", { name: "Default effort" })).toBeInTheDocument();
  });

  it("uses a custom leading option when given", () => {
    render(<EffortPicker value="" onChange={() => {}} label="Effort" leading={{ value: "", label: "Card's own effort" }} />);
    expect(screen.getByRole("option", { name: "Card's own effort" })).toBeInTheDocument();
  });

  it("omits the leading option when `leading={null}`", () => {
    render(<EffortPicker value="high" onChange={() => {}} label="Effort" leading={null} />);
    expect(screen.queryByRole("option", { name: "Default effort" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Card's own effort" })).not.toBeInTheDocument();
  });

  it("forwards the picked value as Effort | ''", async () => {
    const onChange = vi.fn();
    render(<EffortPicker value="high" onChange={onChange} label="Effort" leading={null} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Effort" }), "low");
    expect(onChange).toHaveBeenCalledWith("low");
  });
});
