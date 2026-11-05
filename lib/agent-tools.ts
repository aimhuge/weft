import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { createAgent, listAgents } from "./agent-store";
import { updateCard } from "./store";

// mcp__board__create_agent, in every thread's board tools (lib/board-tools.ts): a thread that knows what an agent
// should be writes one and saves it, so an agent is authored by a thread that knows the shape of a soul, not typed
// into a text box by hand (docs/architecture/agents.md).
//
// The agent it saves is a first-class agent: it lands in Settings → Agents, is pickable in the New thread dialog,
// and can be edited or deleted there like any other. The card that authored it keeps the link, so the list can say
// which thread built which agent.

type Reply = { content: { type: "text"; text: string }[]; isError?: boolean };

const reply = (text: string, isError = false): Reply => ({
  content: [{ type: "text" as const, text }],
  ...(isError ? { isError } : {}),
});

async function attempt(run: () => string | Promise<string>): Promise<Reply> {
  try {
    return reply(await run());
  } catch (err) {
    return reply(err instanceof Error ? err.message : String(err), true);
  }
}

const NAME = z.string().describe("The agent's name, short and in the title case, like Reviewer or Copywriter");
const EMOJI = z.string().optional().describe("One emoji for the agent, like 🔍 or ✍️");
const TAGLINE = z.string().optional().describe("One line: what the agent is for, in the user's words");
const SOUL = z.string().describe("The soul: the start of every system prompt this agent's threads get. Say who it is, what it is for, what it reads first, what it makes and how it shows its work. Write it as instructions to the agent, not as a description of it.");

export function agentTools(getCardId: () => string | undefined) {
  return [
    tool(
      "create_agent",
      "Save a new agent: the soul, the name, an emoji and one line. Its threads open with that soul as the start of their system prompt, so write it as instructions the agent follows. Use this when the user wants an agent that doesn't exist yet; to change one that does, edit it in Settings → Agents.",
      { name: NAME, soul: SOUL, emoji: EMOJI, tagline: TAGLINE },
      ({ name, soul, emoji, tagline }) =>
        attempt(() => {
          const agent = createAgent({ name, soul, emoji, tagline });
          // The card that wrote it keeps the link, so Settings can say which thread built which agent.
          const cardId = getCardId();
          if (cardId) updateCard(cardId, { agentId: agent.id });
          const others = listAgents().length;
          return `Saved the agent ${agent.emoji} ${agent.name} (${agent.id}). There are ${others} agents now; pick it in the New thread dialog.`;
        }),
    ),
  ];
}
