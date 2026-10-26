// @vitest-environment jsdom
// A subagent under an opened card in the list view: what it was asked to do, how it's going, what it
// last did, its type and how long ago it started.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CardTask, TaskStatus } from "@/lib/tasks";
import AgentRow from "./AgentRow";
import "./test-utils";

const NOW = new Date(2025, 2, 12, 9, 0, 0, 0).getTime();

function makeTask(over: Partial<CardTask> = {}): CardTask {
  return {
    id: "t1",
    kind: "agent",
    description: "Explore the auth flow",
    status: "running",
    startedAt: NOW - 120_000,
    ...over,
  };
}

function setup(task: CardTask = makeTask(), depth = 0) {
  return render(<AgentRow task={task} depth={depth} now={NOW} />);
}

describe("AgentRow", () => {
  it("says what the agent was asked to do", () => {
    const view = setup(makeTask({ description: "Explore the auth flow" }));
    expect(view.getByTitle("Explore the auth flow")).toBeInTheDocument();
    expect(view.getByText("Explore the auth flow")).toBeInTheDocument();
  });

  it("says a running agent is running", () => {
    const view = setup(makeTask({ status: "running" }));
    expect(view.getByText("Running")).toBeInTheDocument();
  });

  it("says a finished agent is done, with its mark", () => {
    const view = setup(makeTask({ status: "completed" }));
    expect(view.getByText("Done")).toBeInTheDocument();
    expect(view.getByText("✓")).toBeInTheDocument();
  });

  it("says a failed agent failed", () => {
    const view = setup(makeTask({ status: "failed" }));
    expect(view.getByText("Failed")).toBeInTheDocument();
    expect(view.getByText("✕")).toBeInTheDocument();
  });

  it("says a stopped agent stopped", () => {
    const view = setup(makeTask({ status: "stopped" }));
    expect(view.getByText("Stopped")).toBeInTheDocument();
    expect(view.getByText("■")).toBeInTheDocument();
  });

  it("says an ended agent ended", () => {
    const view = setup(makeTask({ status: "ended" }));
    expect(view.getByText("Ended")).toBeInTheDocument();
    expect(view.getByText("·")).toBeInTheDocument();
  });

  it("says a lost agent was cut off", () => {
    const view = setup(makeTask({ status: "lost" }));
    expect(view.getByText("Cut off")).toBeInTheDocument();
    expect(view.getByText("!")).toBeInTheDocument();
  });

  it("shows the tool a running agent is on, over its summary", () => {
    const view = setup(makeTask({ status: "running", summary: "Looking around", lastTool: "Grep" }));
    expect(view.getByTitle("Grep")).toBeInTheDocument();
    expect(view.queryByTitle("Looking around")).toBeNull();
  });

  it("shows a still-running agent's summary when it has no tool yet", () => {
    const view = setup(makeTask({ status: "running", summary: "Looking around" }));
    expect(view.getByTitle("Looking around")).toBeInTheDocument();
  });

  it("shows a finished agent's summary", () => {
    const view = setup(makeTask({ status: "completed", summary: "Found three callers", lastTool: "Grep" }));
    expect(view.getByTitle("Found three callers")).toBeInTheDocument();
  });

  it("says the agent's type", () => {
    const view = setup(makeTask({ subagentType: "Explore" }));
    expect(view.getByText("Explore")).toBeInTheDocument();
  });

  it("calls an agent with no type an agent", () => {
    const view = setup(makeTask());
    expect(view.getByText("agent")).toBeInTheDocument();
  });

  it("says how many tools the agent used", () => {
    const view = setup(makeTask({ toolUses: 4 }));
    expect(view.getByText("4 tools")).toBeInTheDocument();
  });

  it("says nothing about tools when it used none", () => {
    const view = setup(makeTask());
    expect(view.queryByText(/tools/)).toBeNull();
  });

  it("says how long ago the agent started", () => {
    const view = setup(makeTask({ startedAt: NOW - 7_200_000 }));
    expect(view.getByText("2h")).toBeInTheDocument();
  });

  it("indents a nested agent by its depth", () => {
    const view = setup(makeTask(), 2);
    const holder = view.container.querySelector(".sheet-agent-row span") as HTMLElement;
    expect(holder.style.paddingLeft).toBe("36px");
  });

  it("marks the row as an agent's row", () => {
    const view = setup();
    expect(view.container.querySelector("[data-agent-row]")).not.toBeNull();
  });

  it("shows nothing in the last cell", () => {
    const view = setup();
    expect(view.container.querySelectorAll(".sheet-agent-row > div > span")).toHaveLength(7);
  });

  it.each<TaskStatus>(["running", "completed", "failed", "stopped", "ended", "lost"])("speaks for a %s agent", (status) => {
    const view = setup(makeTask({ status }));
    expect(view.getByText(STATUS_WORD[status])).toBeInTheDocument();
  });
});

const STATUS_WORD: Record<TaskStatus, string> = {
  running: "Running",
  completed: "Done",
  failed: "Failed",
  stopped: "Stopped",
  ended: "Ended",
  lost: "Cut off",
};
