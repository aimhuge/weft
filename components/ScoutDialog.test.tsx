// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Finding, ScoutState } from "@/lib/scout-view";
import ScoutDialog from "./ScoutDialog";

const finding: Finding = {
  id: "lib/a.ts:10:Long Function",
  file: "lib/a.ts",
  line: 10,
  smell: "Long Function",
  category: "refactor",
  severity: "high",
  fix: "Extract the parsing into its own function.",
};

function setup(scout: ScoutState | null, checklistDone = false) {
  const props = { onClose: vi.fn(), onFixChecklist: vi.fn(), onStart: vi.fn(), onRescout: vi.fn() };
  render(<ScoutDialog title="Code quality · weft · 74%" scout={scout} checklistDone={checklistDone} {...props} />);
  return props;
}

const report = { root: "/r", commit: "abcdef123", ranAt: Date.now(), findings: [finding], started: [] };

afterEach(cleanup);

describe("ScoutDialog", () => {
  it("is a titled dialog listing open findings in full", () => {
    setup({ report, running: false });
    expect(screen.getByRole("dialog", { name: "Code quality · weft · 74% ▶" })).toBeTruthy();
    expect(screen.getByText("Extract the parsing into its own function.")).toBeTruthy();
    expect(screen.getByText(/1 open · ran .* on abcdef1/)).toBeTruthy();
  });

  it("starts a finding, fixes the checklist and re-scouts", async () => {
    const p = setup({ report, running: false });
    await userEvent.click(screen.getByText("Long Function"));
    expect(p.onStart).toHaveBeenCalledWith(finding);
    await userEvent.click(screen.getByText("Fix the checklist, weakest first"));
    expect(p.onFixChecklist).toHaveBeenCalled();
    await userEvent.click(screen.getByText("Re-scout now"));
    expect(p.onRescout).toHaveBeenCalled();
  });

  it("closes from the shared Modal's ✕ and Escape", async () => {
    const p = setup(null);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.keyboard("{Escape}");
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });

  it("disables what can't run", () => {
    setup({ report: null, running: true }, true);
    expect(screen.getByText("Fix the checklist, weakest first").closest("button")?.disabled).toBe(true);
    expect(screen.getByText("Scouting…").closest("button")?.disabled).toBe(true);
    expect(screen.getByText(/Scouting the code/)).toBeTruthy();
  });
});
