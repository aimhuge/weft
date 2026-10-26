// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MODELS } from "@/lib/new-thread";
import { EffortPicker, ModelPicker } from "./Pickers";
import { openModels, pickModel, rowName } from "./model-picker-test-utils";
import "./test-utils";

describe("ModelPicker", () => {
  it("groups the models under each CLI's own name", () => {
    render(<ModelPicker value="claude-opus-5-5" onChange={() => {}} label="Model" />);
    const list = openModels("Model");
    expect(within(list).getByRole("group", { name: "Claude Code" })).toBeInTheDocument();
    expect(within(list).getByRole("group", { name: "puku-cli" })).toBeInTheDocument();
    expect(within(list).getByRole("group", { name: /^Codex/ })).toBeInTheDocument();
    expect(within(list).getByRole("option", { name: rowName("Let Codex choose") })).toBeInTheDocument();
  });

  it("shows the picked model's name in the field", () => {
    render(<ModelPicker value="claude-opus-5-5" onChange={() => {}} label="Model" />);
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("Opus 5.5");
  });

  it("offers every model of every CLI — no per-row lock", () => {
    render(<ModelPicker value="claude-opus-5-5" onChange={() => {}} label="Model" />);
    // A Puku and a Codex model are both there: picking one moves that row's CLI to the one
    // that serves it, so no row is limited to one CLI.
    const list = openModels("Model");
    expect(within(list).getByRole("option", { name: rowName("Puku AI 2.8") })).toBeInTheDocument();
    expect(within(list).getByRole("option", { name: rowName("Opus 4.8") })).toBeInTheDocument();
  });

  it("forwards the picked value", () => {
    const onChange = vi.fn();
    render(<ModelPicker value="claude-opus-5-5" onChange={onChange} label="Model" />);
    pickModel("Model", "Opus 4.8");
    expect(onChange).toHaveBeenCalledWith("opus-4.8");
  });

  it("narrows the list to what's typed, across every CLI", () => {
    render(<ModelPicker value="claude-opus-5-5" onChange={() => {}} label="Model" />);
    const list = openModels("Model");
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), { target: { value: "opus" } });
    const names = within(list).getAllByRole("option").map((o) => o.textContent);
    expect(names.every((n) => /opus/i.test(n))).toBe(true);
    expect(names.some((n) => n.startsWith("Opus 4.8"))).toBe(true);
    expect(names.some((n) => n.startsWith("Opus 5.5"))).toBe(true);
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
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("Card's own model");
    const list = openModels("Model");
    const opts = within(list).getAllByRole("option");
    expect(opts[0]).toHaveTextContent("Card's own model");
    // The Claude group follows.
    const claudeGroup = within(list).getByRole("group", { name: "Claude Code" });
    expect(within(claudeGroup).getAllByRole("option")[0]).toHaveTextContent(MODELS.claude[0]!.label);
  });
});

describe("ModelPicker as the CLI picker", () => {
  it("heads each CLI with its own choice, shown once, and picks the CLI with it", () => {
    const onPick = vi.fn();
    const onChange = vi.fn();
    render(<ModelPicker value="" onChange={onChange} label="Model" cli={{ backend: "puku", onPick }} />);
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("Let puku-cli choose");
    expect(within(openModels("Model")).getAllByRole("option", { name: rowName("Let Codex choose") })).toHaveLength(1);
    pickModel("Model", "Let Codex choose");
    expect(onPick).toHaveBeenCalledWith("codex");
    expect(onChange).not.toHaveBeenCalled();
    pickModel("Model", "Opus 5.5");
    expect(onChange).toHaveBeenCalledWith("claude-opus-5-5");
  });

  it("lists a Goose model only when a saved provider key serves it", async () => {
    const listProviders = vi.fn().mockResolvedValue({ providers: [{ id: "openrouter", label: "OpenRouter", envKey: "OPENROUTER_API_KEY", hasKey: true }] });
    const { unmount } = render(<ModelPicker value="" onChange={() => {}} label="Model" />);
    let list = openModels("Model");
    expect(within(list).queryByRole("option", { name: rowName("GPT-4.1 (OpenRouter)") })).toBeNull();
    expect(within(list).getByRole("option", { name: rowName("Let Goose choose") })).toBeInTheDocument();
    unmount();
    (window as unknown as { weft: unknown }).weft = { goose: { listProviders } };
    render(<ModelPicker value="" onChange={() => {}} label="Model" />);
    await waitFor(() => expect(listProviders).toHaveBeenCalled());
    list = openModels("Model");
    expect(await within(list).findByRole("option", { name: rowName("GPT-4.1 (OpenRouter)") })).toBeInTheDocument();
    delete (window as unknown as { weft?: unknown }).weft;
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
