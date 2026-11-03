// Who a card a board tool sends to another host runs as (docs/architecture/project-hosts.md#agents-across-hosts).
// Choosing an agent for a card on another host is a signed widening only Weft's own window makes, so a tool never
// carries one: the host fills in that project's default itself. A Weft Worker reads it from the Mac-signed `agents`
// setting (lib/agent-sync.ts, lib/worker-kinds.ts defaultAgent), and a Mac from its own Settings → Agents
// (lib/new-card.ts). So a tool may name an agent only when it is that default: nothing widens, and the reply is honest.
import { listAgents, projectAgent } from "./agent-store";
import { agentOf } from "./agents";

// The agent a thread with none named starts as.
export const BUILT_IN_DEFAULT = "builder";

// The default a project's new threads start as, by its board path (a Mac folder, or worker://<id>/<folder>), as this
// process knows it: the Mac's own setting, or on a worker the defaults its Mac signed for worker projects.
export const hostDefaultAgent = (project: string): string => projectAgent(project) ?? BUILT_IN_DEFAULT;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const label = (id: string) => {
  const info = agentOf(id, listAgents());
  return info.id === id ? `${info.name} (${id})` : id;
};

// Why a named agent can't go with a card to `project`, or null when it may (none named, or that project's default).
export function agentElsewhereRefusal(named: string | undefined, project: string): string | null {
  if (!named?.trim()) return null;
  const fallback = hostDefaultAgent(project);
  if (same(named, fallback)) return null;
  return `${project} starts new threads as ${label(fallback)}, its default in Settings → Agents. Another agent on a card for another host needs a signed approval, which only Weft's own window makes (with Touch ID), and a thread's tool can't. Leave agent out to start it as ${label(fallback)}, or ask the user to pick ${named.trim()} in New thread on that project.`;
}

// A Mac's project defaults stay on that Mac (lib/agent-store.ts workerProjectAgents), so a worker can't check a name.
export const MAC_AGENT_UNKNOWN =
  "This thread runs on a Weft Worker, which can't see which agent your Mac's project starts new threads as (that default stays on the Mac), so it can't send a card with a named agent there. Leave agent out: the card lands in Backlog with that project's default agent, and the user can pick another before starting it.";

// The note a reply adds once a card went with its host's default.
export const defaultAgentNote = (project: string) => ` It runs as ${label(hostDefaultAgent(project))}, that project's default agent.`;
