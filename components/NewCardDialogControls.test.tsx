// @vitest-environment jsdom
// The New thread dialog's controls row: the folder, the agent, the model and the permission mode.
// Every CLI now runs behind Weft's guards, so there is no "runs without guards" line to show.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Backend } from "@/lib/types";
import "./test-utils";
import { NewCardDialogControls } from "./NewCardDialogControls";

vi.mock("./ModelSelect", () => ({ default: () => null }));
vi.mock("./ModePicker", () => ({ default: () => null }));
vi.mock("./RepoPicker", () => ({ default: () => null }));
vi.mock("./IsolateMenu", () => ({ default: () => null }));

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

  it("says nothing about guards: every CLI runs behind them", () => {
    const { rerender } = render(controls("codex"));
    expect(screen.queryByRole("note")).toBeNull();
    rerender(controls("goose"));
    expect(screen.queryByRole("note")).toBeNull();
    rerender(controls("claude"));
    expect(screen.queryByRole("note")).toBeNull();
  });
});
