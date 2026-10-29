// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MODELS } from "@/lib/new-thread";
import { resetNamedModels } from "@/lib/use-named-models";
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
    // Codex's model lives in its own config, so its one row names it.
    expect(within(list).getByRole("option", { name: rowName("Codex’s configured model") })).toBeInTheDocument();
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
  it("shows the model the CLI runs, and a configured-model row picks the CLI", () => {
    const onPick = vi.fn();
    const onChange = vi.fn();
    render(<ModelPicker value="" onChange={onChange} label="Model" cli={{ backend: "puku", onPick }} />);
    // No model picked: the field shows the model puku-cli runs, not a "let it choose" row.
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("Opus 4.8");
    // Codex's model lives in its own config, so its one row is that model, and it picks the CLI.
    expect(within(openModels("Model")).getAllByRole("option", { name: rowName("Codex’s configured model") })).toHaveLength(1);
    pickModel("Model", "Codex’s configured model");
    expect(onPick).toHaveBeenCalledWith("codex");
    expect(onChange).not.toHaveBeenCalled();
    pickModel("Model", "Opus 5.5");
    expect(onChange).toHaveBeenCalledWith("claude-opus-5-5");
  });

  it("lists a Goose model only when the provider the user set up serves it", async () => {
    // No provider set up: no Goose models but the provider's own pick.
    const { unmount } = render(<ModelPicker value="" onChange={() => {}} label="Model" />);
    let list = openModels("Model");
    expect(within(list).queryByRole("option", { name: rowName("openai/gpt-4.1") })).toBeNull();
    expect(within(list).getByRole("option", { name: rowName("Your BYOK model") })).toBeInTheDocument();
    unmount();

    // OpenRouter set up: its own models are listed, and nobody else's.
    resetNamedModels();
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ gooseProviderId: "openrouter", gooseModelId: "openai/gpt-4.1" }),
    });
    vi.stubGlobal("fetch", fetch);
    render(<ModelPicker value="" onChange={() => {}} label="Model" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    list = openModels("Model");
    expect(await within(list).findByRole("option", { name: rowName("openai/gpt-4.1") })).toBeInTheDocument();
    // Anthropic's own ids are not OpenRouter's, so they are not offered here.
    expect(within(list).queryByRole("option", { name: rowName("claude-sonnet-4-5") })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("shows a named model under Goose even when another CLI's list names the same id", async () => {
    // "puku-ai-2.8" is puku-cli's own id, but the names are a Goose list: a user who named it in
    // the Goose section is serving it through Goose. Filed under puku-cli, the row would hand back
    // a bare id and the thread would start on puku-cli instead of Goose.
    resetNamedModels();
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          gooseProviderId: "anthropic",
          gooseModelId: "puku-ai-2.8",
          gooseNamedModels: [{ id: "puku-ai-2.8", name: "My Puku" }],
        }),
    });
    vi.stubGlobal("fetch", fetch);
    const onChange = vi.fn();
    render(<ModelPicker value="" onChange={onChange} label="Model" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const list = openModels("Model");
    const gooseGroup = await within(list).findByRole("group", { name: "Goose" });
    const row = within(gooseGroup).getByRole("option", { name: rowName("My Puku") });
    expect(row).toBeInTheDocument();
    // The Goose group holds it, so the puku-cli group must not.
    const pukuGroup = within(list).getByRole("group", { name: "puku-cli" });
    expect(within(pukuGroup).queryByRole("option", { name: rowName("My Puku") })).toBeNull();
    // Picking it hands back the prefixed value, so the thread starts on Goose.
    pickModel("Model", "My Puku");
    expect(onChange).toHaveBeenCalledWith("goose:puku-ai-2.8");
    vi.unstubAllGlobals();
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
