// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import { BUILT_IN_AGENTS } from "@/lib/agents";
import { forgetAgentList } from "@/lib/use-agents";
import { STARTER_SOUL } from "./AgentEditor";

const REVIEWER = { id: "a-1", name: "Reviewer", emoji: "🔍", tagline: "Reviews", soul: "You review." };

const api = vi.hoisted(() => ({
  agents: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  resetAgent: vi.fn(),
  setProjectAgent: vi.fn(),
  authorAgent: vi.fn(),
  skillSet: vi.fn(),
  setSkill: vi.fn(),
}));
vi.mock("@/lib/client", () => ({ api }));

// The agent's skills panel (components/SkillSetList) reaches the skill registry, not @/lib/client.
const registry = vi.hoisted(() => ({
  search: vi.fn(),
  preview: vi.fn(),
  install: vi.fn(),
  review: vi.fn(),
  reviewState: vi.fn(),
  scans: vi.fn(),
}));
vi.mock("@/lib/skill-registry-client", () => ({ skillRegistry: registry, startSkillThread: vi.fn() }));

import SettingsAgentsPage from "./SettingsAgentsPage";

beforeEach(() => {
  vi.clearAllMocks();
  // The agent list is a module-level store shared by the whole window; start each test from scratch.
  forgetAgentList();
  api.agents.mockResolvedValue({ agents: [...BUILT_IN_AGENTS, REVIEWER], projects: { "/dev/app": "a-1" } });
  api.createAgent.mockResolvedValue({ agent: REVIEWER });
  api.updateAgent.mockResolvedValue({ agent: REVIEWER });
  api.deleteAgent.mockResolvedValue({ ok: true });
  api.resetAgent.mockResolvedValue({ agent: BUILT_IN_AGENTS[0], from: "github" });
  api.setProjectAgent.mockResolvedValue({ projects: { "/dev/app": "builder" } });
  api.authorAgent.mockResolvedValue({ card: { id: "c1", title: "Write an agent" }, start: { started: true } });
  api.skillSet.mockResolvedValue({ seeded: true, rows: [] });
  api.setSkill.mockResolvedValue({ seeded: true, rows: [] });
  registry.scans.mockResolvedValue({ scans: {} });
  registry.search.mockResolvedValue({ skills: [] });
});

// The list is loaded from the server, so the rows arrive a tick after the first render.
const renderPage = async () => {
  render(<SettingsAgentsPage projects={["/dev/app"]} />);
  await screen.findByText("Reviewer");
};

// One agent's row: every row has its own Edit, Duplicate and Reset/Delete.
const row = (name: string) => {
  const li = screen.getByText(name).closest("li");
  if (!li) throw new Error(`no row for ${name}`);
  return li;
};
const button = (name: string, buttonName: string) => within(row(name)).getByRole("button", { name: buttonName });

describe("SettingsAgentsPage", () => {
  it("lists the built-ins as built in, with Reset and no Delete, and the custom one with Delete", async () => {
    await renderPage();
    expect(screen.getByText("Builder")).toBeInTheDocument();
    expect(screen.getByText("Copywriter")).toBeInTheDocument();
    expect(screen.getByText("Reviewer")).toBeInTheDocument();
    expect(screen.getAllByText("Built in")).toHaveLength(BUILT_IN_AGENTS.length);
    // A built-in can be reset, never deleted; one you made can be deleted, never reset.
    expect(within(row("Builder")).getByRole("button", { name: "Reset" })).toBeInTheDocument();
    expect(within(row("Builder")).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(row("Copywriter")).getByRole("button", { name: "Reset" })).toBeInTheDocument();
    expect(within(row("Copywriter")).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(row("Reviewer")).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(within(row("Reviewer")).queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("resets a built-in to the latest from GitHub", async () => {
    await renderPage();
    await userEvent.click(button("Copywriter", "Reset"));
    await waitFor(() => expect(api.resetAgent).toHaveBeenCalledWith("copywriter"));
    expect(await screen.findByText(/is back to the latest from GitHub/)).toBeInTheDocument();
  });

  it("says when GitHub couldn't be reached and the shipped text came back", async () => {
    api.resetAgent.mockResolvedValue({ agent: BUILT_IN_AGENTS[1], from: "shipped" });
    await renderPage();
    await userEvent.click(button("Copywriter", "Reset"));
    await waitFor(() => expect(api.resetAgent).toHaveBeenCalledWith("copywriter"));
    expect(await screen.findByText(/is back to the text Weft shipped with/)).toBeInTheDocument();
  });

  it("asks before deleting a custom agent, then deletes it", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderPage();
    await userEvent.click(button("Reviewer", "Delete"));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(api.deleteAgent).toHaveBeenCalledWith("a-1"));
  });

  it("opens a new agent's form with the starter soul and saves it", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "+ New agent" }));
    expect(screen.getByLabelText("Soul")).toHaveValue(STARTER_SOUL);
    await userEvent.type(screen.getByLabelText("Name"), "Planner");
    await userEvent.click(screen.getByRole("button", { name: "Add agent" }));
    await waitFor(() => expect(api.createAgent).toHaveBeenCalled());
    expect(api.createAgent.mock.calls[0]?.[0]).toMatchObject({ name: "Planner" });
  });

  it("shows why a new agent couldn't be saved", async () => {
    api.createAgent.mockRejectedValue(new Error("No room for another agent."));
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "+ New agent" }));
    await userEvent.type(screen.getByLabelText("Name"), "Planner");
    await userEvent.click(screen.getByRole("button", { name: "Add agent" }));
    expect(await screen.findByText("No room for another agent.")).toBeInTheDocument();
  });

  it("opens a custom agent's form to edit it and saves it", async () => {
    await renderPage();
    await userEvent.click(button("Reviewer", "Edit"));
    expect(screen.getByLabelText("Soul")).toHaveValue("You review.");
    await userEvent.click(screen.getByRole("button", { name: "Save agent" }));
    await waitFor(() => expect(api.updateAgent).toHaveBeenCalled());
    expect(api.updateAgent.mock.calls[0]?.[0]).toBe("a-1");
    expect(api.updateAgent.mock.calls[0]?.[1]).toMatchObject({ name: "Reviewer", soul: "You review." });
  });

  it("duplicates an agent into a new one named after it", async () => {
    await renderPage();
    await userEvent.click(button("Reviewer", "Duplicate"));
    expect(screen.getByLabelText("Name")).toHaveValue("Reviewer copy");
    // The copy opens as a new agent, so it saves with createAgent, not updateAgent.
    expect(screen.getByRole("button", { name: "Add agent" })).toBeInTheDocument();
  });

  it("sets a project's default agent, and puts Builder back as no agent", async () => {
    await renderPage();
    const select = screen.getByLabelText("Default agent for app");
    expect(select).toHaveValue("a-1");
    await userEvent.selectOptions(select, "builder");
    await waitFor(() => expect(api.setProjectAgent).toHaveBeenCalledWith("/dev/app", null));
  });
});

describe("Settings → Agents: building an agent with a thread", () => {
  it("offers to build the agent with a thread", async () => {
    await renderPage();
    expect(screen.getByRole("button", { name: "Build it with a thread" })).toBeInTheDocument();
  });

  it("starts a thread with the brief, and says where the agent will appear", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Build it with a thread" }));
    await userEvent.type(screen.getByLabelText("What the agent is for"), "Reviews pull requests.");
    await userEvent.click(screen.getByRole("button", { name: "Start the thread" }));
    await waitFor(() => expect(api.authorAgent).toHaveBeenCalled());
    expect(api.authorAgent.mock.calls[0]?.[0]).toMatchObject({ what: "Reviews pull requests." });
    expect(await screen.findByText(/is on your board and running/)).toBeInTheDocument();
  });

  it("keeps the button disabled until there is a brief", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Build it with a thread" }));
    expect(screen.getByRole("button", { name: "Start the thread" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("What the agent is for"), "x");
    expect(screen.getByRole("button", { name: "Start the thread" })).toBeEnabled();
  });

  it("says why the thread couldn't be started", async () => {
    api.authorAgent.mockRejectedValue(new Error("Say what the agent is for, in a sentence."));
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Build it with a thread" }));
    await userEvent.type(screen.getByLabelText("What the agent is for"), "Reviews.");
    await userEvent.click(screen.getByRole("button", { name: "Start the thread" }));
    expect(await screen.findByText("Say what the agent is for, in a sentence.")).toBeInTheDocument();
  });
});
