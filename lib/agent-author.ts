// The brief the authoring thread runs on (Settings → Agents → "Build it with a thread"): what makes a good soul,
// so the thread writes one that works instead of a line of user wishes (docs/architecture/agents.md).
//
// The soul is the first part of every system prompt the agent's threads get. It is not a description of the agent:
// it is the agent's standing instructions. A thread that writes it as "You are a careful reviewer" gets a thread that
// reviews carefully but knows nothing about what to read first, what to make, or when to stop. A thread that writes
// it as instructions gets all three.

// What the user asked the agent to be, in their words. The thread fills in the rest.
export function agentAuthorPrompt(what: string): string {
  return `You are writing a new agent for Weft. The user wants an agent that: ${what.trim()}

Write that agent's soul and save it with the create_agent tool.

A soul is the first part of every system prompt the agent's threads get, so write it as standing instructions to the agent, not as a description of it. "You review code" describes; "Read the diff before you judge anything" instructs, and only the second changes what the thread does.

A good soul says, in this order:
1. Who the agent is, in one line, and what it is for.
2. What it reads first, and in what order.
3. What it makes, and what it must never do.
4. How it shows its work: what ends up in the browser pane, what it says when it is done.
5. What it does when it is unsure or blocked, and when it should stop and ask.

Keep it concrete. Name the files, the commands and the steps a thread of this kind actually takes, in the order they happen. A soul of real instructions is worth more than a soul of good intentions: "read the failing test, then the code it names, then the diff that changed it" beats "be thorough and investigate root causes".

Leave out anything the agent's threads already have: the tools, the browser pane, the vault, the board, the review tour, and the project's own CLAUDE.md, AGENTS.md and SOUL.md. An agent changes who a thread is, not what it can do.

Give it a short name in the title case (Reviewer, Planner, Copywriter), one emoji, and one line for what it is for. Then call create_agent with the name, the emoji, the one line and the soul.

Do not create the agent until the soul is one you would want to work under yourself.`;
}

// The line Settings shows under the button, so the user knows what happens before they press it.
export const AGENT_AUTHOR_BLURB =
  "A thread on your board writes the agent's soul for you: it reads the brief, writes the instructions, and saves the agent. You can edit it afterwards.";
