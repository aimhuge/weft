// @vitest-environment jsdom
// The New thread dialog's controls row: a CLI that runs without Weft's guards says so in one line, and only then.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Backend } from "@/lib/types";
import "./test-utils";
import { NewCardDialogControls } from "./NewCardDialogControls";

vi.mock("./ModelSelect", () => ({ default: () => null }));
vi.mock("./ModePicker", () => ({ default: () => null }));
vi.mock("./RepoPicker", () => ({ default: () => null }));

const controls = (backend: Backend) => (
  <NewCardDialogControls
    cwd="/p"
    home="/home"
    backend={backend}
    model=""
    effort=""
    permissionMode="default"
    onChooseFolder={vi.fn()}
    onPickModel={vi.fn()}
    onPickCli={vi.fn()}
    onPickEffort={vi.fn()}
    onPickMode={vi.fn()}
  />
);

describe("NewCardDialogControls", () => {
  afterEach(cleanup);

  it("warns in one line when Codex or Goose is picked", () => {
    const { rerender } = render(controls("codex"));
    expect(screen.getByRole("note")).toHaveTextContent("Codex runs without Weft's guards: no secret guard, folder gate or Bash hooks.");
    rerender(controls("goose"));
    expect(screen.getByRole("note")).toHaveTextContent(/^Goose runs without Weft's guards/);
  });

  it("says nothing for the guarded CLIs", () => {
    const { rerender } = render(controls("claude"));
    expect(screen.queryByRole("note")).toBeNull();
    rerender(controls("puku"));
    expect(screen.queryByRole("note")).toBeNull();
  });
});
