// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MODELS } from "@/lib/new-thread";
import { EffortPicker, ModelPicker } from "./Pickers";
import "./test-utils";

describe("ModelPicker", () => {
  it("groups the models under each CLI's own name", () => {
    render(<ModelPicker value="claude-opus-5-5" onChange={() => {}} label="Model" />);
    expect(screen.getByRole("group", { name: "Claude Code" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "puku-cli" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Codex · no Weft guards" })).toBeInTheDocument();
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
    const claudeGroup = screen.getByRole("group", { name: "Claude Code" });
    expect(claudeGroup.children[0]).toHaveTextContent(MODELS.claude[0]!.label);
  });
});

describe("ModelPicker as the CLI picker", () => {
  it("heads each CLI with its own default, shown once, and picks the CLI with it", async () => {
    const onPick = vi.fn();
    const onChange = vi.fn();
    render(<ModelPicker value="" onChange={onChange} label="Model" cli={{ backend: "puku", onPick }} />);
    const picker = screen.getByRole("combobox", { name: "Model" });
    expect(picker).toHaveValue("cli:puku");
    expect(screen.getAllByRole("option", { name: "Codex default" })).toHaveLength(1);
    await userEvent.selectOptions(picker, "cli:codex");
    expect(onPick).toHaveBeenCalledWith("codex");
    await userEvent.selectOptions(picker, "claude-opus-5-5");
    expect(onChange).toHaveBeenCalledWith("claude-opus-5-5");
  });

  it("lists a Goose model only when a saved provider key serves it", async () => {
    const listProviders = vi.fn().mockResolvedValue({ providers: [{ id: "openrouter", label: "OpenRouter", envKey: "OPENROUTER_API_KEY", hasKey: true }] });
    const { unmount } = render(<ModelPicker value="" onChange={() => {}} label="Model" />);
    expect(screen.queryByRole("option", { name: "GPT-4.1 (OpenRouter)" })).toBeNull();
    expect(screen.getByRole("option", { name: "Goose default" })).toBeInTheDocument();
    unmount();
    (window as unknown as { weft: unknown }).weft = { goose: { listProviders } };
    render(<ModelPicker value="" onChange={() => {}} label="Model" />);
    expect(await screen.findByRole("option", { name: "GPT-4.1 (OpenRouter)" })).toBeInTheDocument();
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
