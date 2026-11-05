// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_AGENTS } from "./agents";
import { forgetAgentList, refreshAgents, showAgents, useAgentList, useAgents } from "./use-agents";

// The window's one list of agents (lib/use-agents.ts): shipped until the server answers, the server's after, and the
// shipped one again where there's no server to ask.

const api = vi.hoisted(() => ({ agents: vi.fn() }));
vi.mock("./client", () => ({ api }));

function Names() {
  const { projects } = useAgentList();
  return createElement("p", null, `${useAgents().map((a) => a.name).join(",")}|${Object.keys(projects).join(",")}`);
}

const reviewer = { id: "a-1", name: "Reviewer", emoji: "🔍", tagline: "", soul: "s" };

beforeEach(() => {
  forgetAgentList();
  api.agents.mockReset();
});

describe("useAgents", () => {
  it("draws the shipped list on the server, before anything is read", () => {
    expect(renderToString(createElement(Names))).toContain("Builder,Copywriter|");
  });

  it("reads the server's list once, and every user follows a change", async () => {
    api.agents.mockResolvedValue({ agents: [...BUILT_IN_AGENTS, reviewer], projects: { "/dev/app": "a-1" } });
    const { unmount } = render(createElement(Names));
    expect(await screen.findByText("Builder,Copywriter,Reviewer|/dev/app")).toBeTruthy();
    act(() => showAgents({ projects: {} }));
    expect(screen.getByText("Builder,Copywriter,Reviewer|")).toBeTruthy();
    expect(api.agents).toHaveBeenCalledTimes(1);
    unmount();
    showAgents({ agents: BUILT_IN_AGENTS });
  });

  it("keeps the shipped list when there's no agents route to ask", async () => {
    api.agents.mockImplementation(() => {
      throw new TypeError("api.agents is not a function");
    });
    await refreshAgents();
    render(createElement(Names));
    expect(screen.getByText("Builder,Copywriter|")).toBeTruthy();
  });
});
