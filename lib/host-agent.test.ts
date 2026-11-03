import { beforeEach, describe, expect, it, vi } from "vitest";

// Who a card sent to another host runs as (lib/host-agent.ts): the defaults are a fake Settings → Agents.
const defaults = vi.hoisted(() => {
  const projects: Record<string, string> = {};
  return { projects };
});
vi.mock("./agent-store", async () => {
  const { BUILT_IN_AGENTS } = await import("./agents");
  return { listAgents: () => BUILT_IN_AGENTS, projectAgent: (cwd: string) => defaults.projects[cwd] };
});

const { agentElsewhereRefusal, BUILT_IN_DEFAULT, defaultAgentNote, hostDefaultAgent, MAC_AGENT_UNKNOWN } = await import("./host-agent");

const SITE = "worker://w2/site";

beforeEach(() => {
  defaults.projects = {};
});

describe("hostDefaultAgent", () => {
  it("is the project's default, else Builder", () => {
    expect(hostDefaultAgent(SITE)).toBe(BUILT_IN_DEFAULT);
    defaults.projects[SITE] = "copywriter";
    expect(hostDefaultAgent(SITE)).toBe("copywriter");
  });
});

describe("agentElsewhereRefusal", () => {
  it("lets none named through", () => {
    expect(agentElsewhereRefusal(undefined, SITE)).toBeNull();
    expect(agentElsewhereRefusal("  ", SITE)).toBeNull();
  });

  it("lets the default through, whatever its case", () => {
    expect(agentElsewhereRefusal(" Builder ", SITE)).toBeNull();
    defaults.projects[SITE] = "copywriter";
    expect(agentElsewhereRefusal("copywriter", SITE)).toBeNull();
  });

  it("refuses another, naming the default and the way to pick one", () => {
    defaults.projects[SITE] = "copywriter";
    const text = agentElsewhereRefusal("builder", SITE);
    expect(text).toContain("worker://w2/site starts new threads as Copywriter (copywriter)");
    expect(text).toContain("only Weft's own window makes");
    expect(text).toContain("pick builder in New thread");
  });

  it("names an id it can't find as the id", () => {
    defaults.projects[SITE] = "unknown-one";
    expect(agentElsewhereRefusal("builder", SITE)).toContain("starts new threads as unknown-one,");
  });
});

describe("the notes", () => {
  it("says which agent runs it", () => {
    expect(defaultAgentNote(SITE)).toBe(" It runs as Builder (builder), that project's default agent.");
  });

  it("says why a Mac's default can't be checked from a worker", () => {
    expect(MAC_AGENT_UNKNOWN).toMatch(/Leave agent out/);
  });
});
