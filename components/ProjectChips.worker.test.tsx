// @vitest-environment jsdom
// A worker project's chip (components/ProjectChips.tsx): the project's name, the worker it runs on, and
// where it says it lives.
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { noteRelay, resetWorkerRoute, setWorkerRoute } from "@/lib/worker-route";
const held = vi.hoisted(() => [] as (string | null | undefined)[]);
vi.mock("@/lib/session-lines", () => ({ useSessionLine: (id: string | null | undefined) => void held.push(id) }));
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

describe("a worker chip's route", () => {
  it("says relay with the last round trip, and direct when H6 reports it", () => {
    act(() => noteRelay("w1", 612));
    renderChips([summary({ worker: { name: "m1mini", status: "online" } })]);
    expect(screen.getByTitle("on m1mini · relay · 612 ms")).toBeInTheDocument();
    act(() => setWorkerRoute("w1", "direct", 4));
    expect(screen.getByTitle("on m1mini · direct · 4 ms")).toBeInTheDocument();
    act(() => resetWorkerRoute());
  });

  it("shows no route for a worker with none noted", () => {
    act(() => noteRelay("w2", 9));
    renderChips([summary({ worker: { name: "m1mini", status: "online" } })]);
    expect(screen.getByTitle("on m1mini")).toBeInTheDocument();
    act(() => resetWorkerRoute());
  });
});

describe("showing a worker's project", () => {
  it("holds its session line while it's selected and the worker is up, and nothing otherwise", () => {
    held.length = 0;
    renderChips([summary({ worker: { name: "m1mini", status: "online" } })], "worker://w1/ling");
    expect(held.at(-1)).toBe("w1");
    renderChips([summary({ worker: { name: "m1mini", status: "offline" } })], "worker://w1/ling");
    expect(held.at(-1)).toBeNull();
    renderChips([summary({ worker: { name: "m1mini", status: "online" } })]);
    expect(held.at(-1)).toBeNull();
  });
});
