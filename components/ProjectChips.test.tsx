// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProjectChips from "./ProjectChips";
import "./test-utils";
import type { ProjectSummary } from "@/lib/board-view";

const row = (path: string, extra: Partial<ProjectSummary> = {}): ProjectSummary => ({ path, lastActivity: 0, cards: 1, running: 0, needsYou: 0, ...extra });

function setup(projects: ProjectSummary[], onProjectMenu?: (path: string, e: React.MouseEvent) => void) {
  render(
    <ProjectChips projects={projects} total={2} selected={null} onSelect={vi.fn()} home="/Users/me" chipsRef={createRef()} stepHint="" onProjectMenu={onProjectMenu} />,
  );
}

afterEach(cleanup);

describe("ProjectChips", () => {
  it("opens a project's menu on right-click", () => {
    const onProjectMenu = vi.fn();
    setup([row("/dev/weft")], onProjectMenu);
    fireEvent.contextMenu(screen.getByRole("button", { name: /weft/ }));
    expect(onProjectMenu).toHaveBeenCalledWith("/dev/weft", expect.anything());
  });

  it("puts pinned projects first and leaves hidden ones out", () => {
    setup([row("/dev/a"), row("/dev/b", { pinned: true }), row("/dev/c", { hidden: true })]);
    const names = screen.getAllByRole("button").map((b) => b.textContent.charAt(0));
    expect(names).toEqual(["A", "b", "a"]);
  });
});
