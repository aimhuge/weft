// @vitest-environment jsdom
// A worker project's chip (components/ProjectChips.tsx): the project's name, the worker it runs on, and
// where it says it lives.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import ProjectChips from "./ProjectChips";
import type { ProjectSummary } from "@/lib/board-view";
import "./test-utils";

const summary = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({ path: "worker://w1/ling", lastActivity: 0, cards: 2, running: 0, needsYou: 0, ...over });

function renderChips(projects: ProjectSummary[], selected: string | null = null) {
  return render(
    <ProjectChips
      projects={projects}
      total={2}
      selected={selected}
      onSelect={() => {}}
      home="/Users/me"
      chipsRef={createRef<HTMLDivElement>()}
      stepHint=""
    />,
  );
}

describe("a worker project's chip", () => {
  it("shows the worker's name and that it runs there", () => {
    renderChips([summary({ worker: { name: "m1mini", status: "online" } })]);
    expect(screen.getByText("ling")).toBeInTheDocument();
    expect(screen.getByText("m1mini")).toBeInTheDocument();
  });

  it("says the worker is offline when it is", () => {
    renderChips([summary({ worker: { name: "m1mini", status: "offline" } })]);
    expect(screen.getByText("m1mini")).toBeInTheDocument();
    expect(screen.getByTitle("on m1mini · offline")).toBeInTheDocument();
  });

  it("says where a local project lives instead", () => {
    renderChips([{ path: "/dev/app", lastActivity: 0, cards: 1, running: 0, needsYou: 0 }]);
    expect(screen.getByTitle("/dev/app")).toBeInTheDocument();
  });
});
