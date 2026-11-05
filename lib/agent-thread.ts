import { folderName } from "./format";

// The new thread that designs an agent (docs/architecture/github-issues.md).
//
// It is a special kind of new thread: the GitHub drawer's "Design the agent" starts one instead of
// opening a form. There are no questions in Weft — the questions live in the thread, which asks them
// one at a time and writes the soul from the answers, the way it already does for Settings →
// Agents → "Build it with a thread" (lib/agent-author.ts).
//
// What Weft contributes is the brief and the page: the thread knows the project it is designing
// an agent for, and the pane shows the brief it is running on while it works.

// The brief, in the user's words: the project, and the job the agent is for.
export interface AgentBrief {
  // The project the agent belongs to, e.g. "/Users/fotoflo/dev/weft".
  project: string;
  // What the agent is for, in a sentence: "triages GitHub issues".
  job: string;
}

// The name of the project, the way a person says it: "weft", not the whole path.
export function briefProjectName(project: string): string {
  return folderName(project) || project;
}

// The thread's title: "Design an agent for weft".
export function briefTitle(brief: AgentBrief): string {
  return `Design an agent for ${briefProjectName(brief.project)}`;
}

// The prompt the thread runs on. It is a request, not a questionnaire: the thread works out the
// questions itself, from the brief and from the project it is in.
export function briefPrompt(brief: AgentBrief): string {
  const project = briefProjectName(brief.project);
  return `Help me design an agent for ${project} that ${brief.job.trim()}

Ask me what you need to know — one question at a time, and only the ones that change what you write. Do not ask me what I already said.

Then write the agent's soul and save it with the create_agent tool.

A soul is the first part of every system prompt the agent's threads get, so write it as standing instructions to the agent, not as a description of it. "You review code" describes; "Read the diff before you judge anything" instructs, and only the second changes what the thread does.

A good soul says, in this order:
1. Who the agent is, in one line, and what it is for.
2. What it reads first, and in what order.
3. What it makes, and what it must never do.
4. How it shows its work: what ends up in the browser pane, what it says when it is done.
5. What it does when it is unsure or blocked, and when it should stop and ask.

Keep it concrete. Name the files, the commands and the steps a thread of this kind actually takes, in the order they happen. A soul of real instructions is worth more than a soul of good intentions.

Leave out anything the agent's threads already have: the tools, the browser pane, the vault, the board, the review tour, and the project's own CLAUDE.md, AGENTS.md and SOUL.md. An agent changes who a thread is, not what it can do.

Give it a short name in the title case (Reviewer, Planner, Triage), one emoji, and one line for what it is for. Then call create_agent with the name, the emoji, the one line and the soul.

Do not create the agent until the soul is one you would want to work under yourself.`;
}
