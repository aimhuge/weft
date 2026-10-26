import BUILT_IN from "./agents-built-in.json";

// Who a thread is: its soul, the first part of its system prompt (lib/weft-prompts.ts). Builder is the soul every thread
// had before agents, Weft's own (SOUL.md); Copywriter writes in Weft's voice; you make more in Settings → Agents
// (lib/agent-store.ts). An agent changes who the thread is, not what it can do: every one keeps the browser pane, the
// vault, the board and the rest. The CLI reads its system prompt only when it starts, so a card that switches agent gets
// a new CLI that resumes the same conversation (docs/architecture/agents.md).
//
// This file is shared with the board, so it holds no storage: the agents you made or edited come in as a list.

// An agent's id: a built-in's name ("builder", "copywriter") or one made in Settings ("a-1b2c3d4e").
export type ThreadAgent = string;

export interface AgentInfo {
  id: ThreadAgent;
  name: string;
  // Shown beside the name in the pickers and on the card's mark.
  emoji: string;
  // One line for the pickers' tooltips and the Settings list.
  tagline: string;
  // The soul: the first part of the thread's system prompt.
  soul: string;
  // Skills and plugins this agent's threads don't get, on top of the project's off-list (lib/skill-sets.ts offFor).
  skillsOff?: string[];
  // Ships with Weft (lib/agents-built-in.json): it can be edited and reset, never deleted.
  builtIn?: boolean;
  // A built-in whose text isn't the one that shipped: "you" edited it, or a reset brought "github"'s newer one.
  changed?: "you" | "github";
}

// The built-ins as they ship. The same file on GitHub is what Reset pulls (lib/agent-store.ts resetAgent).
export const BUILT_IN_AGENTS: AgentInfo[] = BUILT_IN.map((a) => ({ ...a, builtIn: true }));

const shipped = (id: string) => BUILT_IN_AGENTS.find((a) => a.id === id);

// A built-in as it shipped; the JSON missing one is a broken build, so it says so.
export function shippedAgent(id: string): AgentInfo {
  const agent = shipped(id);
  if (!agent) throw new Error(`lib/agents-built-in.json has no "${id}" agent.`);
  return agent;
}

// Where Weft's identity and conventions live, so a thread can find them even if a later refactor drops a piece of this prompt.
// Builder's shipped soul; the copilot always starts with it (an edit in Settings changes Builder threads only).
export const WEFT_SOUL_PROMPT = shippedAgent("builder").soul;
export const COPYWRITER_SOUL_PROMPT = shippedAgent("copywriter").soul;

export const isBuiltIn = (id: string) => Boolean(shipped(id));

// Every agent, built-ins first: what you saved over a built-in replaces it, and the ones you made follow in order.
export function mergeAgents(saved: AgentInfo[] = []): AgentInfo[] {
  const over = new Map(saved.filter((a) => isBuiltIn(a.id)).map((a) => [a.id, a]));
  const builtIns = BUILT_IN_AGENTS.map((a) => {
    const mine = over.get(a.id);
    // Saved only for its skills, a built-in still reads as shipped.
    const edited = (["name", "emoji", "tagline", "soul"] as const).some((k) => (mine?.[k] ?? "") !== a[k]);
    return mine ? { ...mine, builtIn: true, changed: mine.changed ?? (edited ? "you" : undefined) } : a;
  });
  return [...builtIns, ...saved.filter((a) => !isBuiltIn(a.id)).map((a) => ({ ...a, builtIn: undefined, changed: undefined }))];
}

export function findAgent(id: string | undefined, agents: AgentInfo[] = BUILT_IN_AGENTS): AgentInfo | undefined {
  return id === undefined ? undefined : agents.find((a) => a.id === id);
}

export function isAgent(value: unknown, agents: AgentInfo[] = BUILT_IN_AGENTS): value is ThreadAgent {
  return typeof value === "string" && Boolean(findAgent(value, agents));
}

// The card's agent, Builder when it has none (every card made before agents) or one that was deleted.
export function agentOf(agent: string | undefined, agents: AgentInfo[] = BUILT_IN_AGENTS): AgentInfo {
  return findAgent(agent, agents) ?? findAgent("builder", agents) ?? shippedAgent("builder");
}

// What a card stores: Builder is stored as no agent, so old cards and new default ones read the same.
export function storedAgent(value: unknown, agents: AgentInfo[] = BUILT_IN_AGENTS): ThreadAgent | undefined {
  return isAgent(value, agents) && value !== "builder" ? value : undefined;
}

// Every shipped soul, for the build fingerprint (lib/weft-prompts.ts): editing one replaces idle CLIs on the old text.
// The ones you saved count through lib/agent-store.ts savedAgentsHash.
export const AGENT_SOULS = BUILT_IN_AGENTS.map((a) => a.soul).join("\n\0\n");
