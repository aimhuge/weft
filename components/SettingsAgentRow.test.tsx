// @vitest-environment jsdom
// One agent's row in Settings → Agents (components/SettingsAgentRow.tsx): what a built-in, a team's agent and one you
// made each show and do, and sharing one of yours with your teams. Also AgentEditor's read-only form for a team's agent.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import { BUILT_IN_AGENTS, type AgentInfo, type TeamRef } from "@/lib/agents";

const api = vi.hoisted(() => ({
  agents: vi.fn(),
  shareAgent: vi.fn(),
  unshareAgent: vi.fn(),
  skillSet: vi.fn(),
  setSkill: vi.fn(),
  updateAgent: vi.fn(),
  createAgent: vi.fn(),
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

// The real agent list, with showAgents watched so a share's answer can be seen reaching it.
vi.mock("@/lib/use-agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/use-agents")>();
  return { ...actual, showAgents: vi.fn(actual.showAgents) };
});

import { showAgents } from "@/lib/use-agents";
import AgentEditor from "./AgentEditor";
import SettingsAgentRow, { type AgentRowActions } from "./SettingsAgentRow";

const ACME: TeamRef = { id: "org-1", name: "Acme" };
const BETA: TeamRef = { id: "org-2", name: "Beta" };
const COPYWRITER = BUILT_IN_AGENTS[1] as AgentInfo;
const TEAM_AGENT: AgentInfo = { id: "t-12345678-a-1", name: "Reviewer", emoji: "🔍", tagline: "Reviews", soul: "s", team: ACME };
const MINE: AgentInfo = { id: "a-1", name: "Reviewer", emoji: "🔍", tagline: "Reviews", soul: "You review." };

const actions = (): AgentRowActions => ({ onEdit: vi.fn(), onDuplicate: vi.fn(), onReset: vi.fn(), onDelete: vi.fn() });

const renderRow = (agent: AgentInfo, teams: TeamRef[] = [], sharedWith: string[] = [], acts = actions()) => {
  render(<SettingsAgentRow agent={agent} teams={teams} sharedWith={sharedWith} actions={acts} />);
  return acts;
};

const button = (name: string) => screen.getByRole("button", { name });
const noButton = (name: string) => expect(screen.queryByRole("button", { name })).toBeNull();
const shareSelect = () => screen.getByLabelText("Share Reviewer with a team");
const stopAcme = () => button("Stop sharing Reviewer with Acme");

// What the share routes answer: the whole list, your teams and every agent's shares.
const ANSWER = { agents: [...BUILT_IN_AGENTS, MINE], teams: [ACME, BETA], shares: { "a-1": ["org-1", "org-2"] } };

// A call that stays pending until the test settles it.
function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.agents.mockResolvedValue({ agents: BUILT_IN_AGENTS, projects: {}, teams: [], shares: {} });
  api.shareAgent.mockResolvedValue(ANSWER);
  api.unshareAgent.mockResolvedValue(ANSWER);
  api.skillSet.mockResolvedValue({ seeded: true, rows: [] });
  registry.scans.mockResolvedValue({ scans: {} });
  registry.search.mockResolvedValue({ skills: [] });
});

describe("SettingsAgentRow: a built-in", () => {
  it("is marked built in, edits, duplicates and resets, and never deletes or shares", async () => {
    const acts = renderRow(COPYWRITER, [ACME, BETA]);
    expect(screen.getByText(COPYWRITER.name)).toBeInTheDocument();
    expect(screen.getByText("Built in")).toBeInTheDocument();
    noButton("Delete");
    expect(screen.queryByText(/Shared with/)).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    await userEvent.click(button("Edit"));
    expect(acts.onEdit).toHaveBeenCalledTimes(1);
    await userEvent.click(button("Duplicate"));
    expect(acts.onDuplicate).toHaveBeenCalledTimes(1);
    await userEvent.click(button("Reset"));
    expect(acts.onReset).toHaveBeenCalledTimes(1);
  });

  it("has no mark of a change while it's as shipped", () => {
    renderRow(COPYWRITER);
    expect(screen.queryByText("Edited")).toBeNull();
    expect(screen.queryByText("Latest from GitHub")).toBeNull();
  });

  it("says Edited when you changed it", () => {
    renderRow({ ...COPYWRITER, changed: "you" });
    expect(screen.getByText("Edited")).toBeInTheDocument();
  });

  it("says Latest from GitHub when Reset brought newer text", () => {
    renderRow({ ...COPYWRITER, changed: "github" });
    expect(screen.getByText("Latest from GitHub")).toBeInTheDocument();
  });
});

describe("SettingsAgentRow: a team's agent", () => {
  it("shows its team, views and duplicates, and never deletes, resets or shares", async () => {
    const acts = renderRow(TEAM_AGENT, [ACME, BETA]);
    expect(screen.getByText("Acme")).toHaveAttribute("title", "Shared by a teammate in Acme");
    expect(screen.queryByText("Built in")).toBeNull();
    noButton("Edit");
    noButton("Delete");
    noButton("Reset");
    expect(screen.queryByText(/Shared with/)).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    await userEvent.click(button("View"));
    expect(acts.onEdit).toHaveBeenCalledTimes(1);
    await userEvent.click(button("Duplicate"));
    expect(acts.onDuplicate).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsAgentRow: one you made", () => {
  it("edits, duplicates and deletes, and never resets", async () => {
    const acts = renderRow(MINE);
    expect(screen.getByText("Reviews")).toBeInTheDocument();
    noButton("Reset");
    await userEvent.click(button("Edit"));
    expect(acts.onEdit).toHaveBeenCalledTimes(1);
    await userEvent.click(button("Duplicate"));
    expect(acts.onDuplicate).toHaveBeenCalledTimes(1);
    await userEvent.click(button("Delete"));
    expect(acts.onDelete).toHaveBeenCalledTimes(1);
  });

  it("shows no share controls when you're in no team", () => {
    renderRow(MINE, [], []);
    expect(screen.queryByText(/Shared with/)).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("shows the teams it's shared with and offers only the others", () => {
    renderRow(MINE, [ACME, BETA], ["org-1"]);
    expect(screen.getByText("Shared with Acme")).toBeInTheDocument();
    expect(screen.queryByText("Shared with Beta")).toBeNull();
    expect(stopAcme()).toBeEnabled();
    const options = Array.from(shareSelect().querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["Share with…", "Beta"]);
    expect(shareSelect()).toHaveValue("");
  });

  it("has no menu once every team has it", () => {
    renderRow(MINE, [ACME, BETA], ["org-1", "org-2"]);
    expect(screen.getByText("Shared with Acme")).toBeInTheDocument();
    expect(screen.getByText("Shared with Beta")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("shares it with the team you pick and puts the answer in the agent list", async () => {
    renderRow(MINE, [ACME, BETA], ["org-1"]);
    await userEvent.selectOptions(shareSelect(), "org-2");
    expect(api.shareAgent).toHaveBeenCalledWith("a-1", "org-2");
    await waitFor(() => expect(showAgents).toHaveBeenCalledWith(ANSWER));
    await waitFor(() => expect(shareSelect()).toBeEnabled());
  });

  it("stops sharing it with a team on ✕ and puts the answer in the agent list", async () => {
    renderRow(MINE, [ACME, BETA], ["org-1"]);
    await userEvent.click(stopAcme());
    expect(api.unshareAgent).toHaveBeenCalledWith("a-1", "org-1");
    await waitFor(() => expect(showAgents).toHaveBeenCalledWith(ANSWER));
  });

  it("disables the controls while a call is out, and frees them when it's back", async () => {
    const call = deferred<typeof ANSWER>();
    api.shareAgent.mockReturnValue(call.promise);
    renderRow(MINE, [ACME, BETA], ["org-1"]);
    await userEvent.selectOptions(shareSelect(), "org-2");
    expect(shareSelect()).toBeDisabled();
    expect(stopAcme()).toBeDisabled();
    call.resolve(ANSWER);
    await waitFor(() => expect(shareSelect()).toBeEnabled());
    expect(stopAcme()).toBeEnabled();
  });

  it("says why a share failed, and leaves the list alone", async () => {
    api.shareAgent.mockRejectedValue(new Error("You're not in that team."));
    renderRow(MINE, [ACME, BETA], ["org-1"]);
    await userEvent.selectOptions(shareSelect(), "org-2");
    expect(await screen.findByText("You're not in that team.")).toBeInTheDocument();
    expect(showAgents).not.toHaveBeenCalled();
    await waitFor(() => expect(shareSelect()).toBeEnabled());
  });

  it("says why stopping a share failed", async () => {
    api.unshareAgent.mockRejectedValue(new Error("Couldn't reach weft.zip."));
    renderRow(MINE, [ACME, BETA], ["org-1"]);
    await userEvent.click(stopAcme());
    expect(await screen.findByText("Couldn't reach weft.zip.")).toBeInTheDocument();
  });

  it("clears an old error when the next call starts", async () => {
    api.shareAgent.mockRejectedValueOnce(new Error("You're not in that team."));
    renderRow(MINE, [ACME, BETA], ["org-1"]);
    await userEvent.selectOptions(shareSelect(), "org-2");
    expect(await screen.findByText("You're not in that team.")).toBeInTheDocument();
    await waitFor(() => expect(shareSelect()).toBeEnabled());
    await userEvent.selectOptions(shareSelect(), "org-2");
    await waitFor(() => expect(screen.queryByText("You're not in that team.")).toBeNull());
  });
});

describe("AgentEditor: a team's agent", () => {
  it("shows it read-only, says who shared it, and only closes", async () => {
    const onDone = vi.fn();
    render(<AgentEditor agent={TEAM_AGENT} onDone={onDone} />);
    for (const label of ["Name", "Emoji", "One line", "Soul"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("readonly");
    }
    expect(screen.getByLabelText("Name")).toHaveValue("Reviewer");
    expect(screen.getByLabelText("Soul")).toHaveValue("s");
    expect(screen.getByText("Shared by Acme. Duplicate it to make a copy you can change.")).toBeInTheDocument();
    noButton("Save agent");
    noButton("Cancel");
    expect(screen.queryByText(/Skills: what its threads get/)).toBeNull();
    expect(api.skillSet).not.toHaveBeenCalled();
    await userEvent.click(button("Close"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("keeps a read-only field's text when you type into it", async () => {
    render(<AgentEditor agent={TEAM_AGENT} onDone={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Name"), "x");
    expect(screen.getByLabelText("Name")).toHaveValue("Reviewer");
  });

  it("edits one of yours with Save and its skills, for contrast", async () => {
    render(<AgentEditor agent={MINE} onDone={vi.fn()} />);
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("readonly");
    expect(button("Save agent")).toBeInTheDocument();
    expect(button("Cancel")).toBeInTheDocument();
    await waitFor(() => expect(api.skillSet).toHaveBeenCalledWith({ agent: "a-1" }));
  });
});
