import { createAgent } from "./agent-store";
import type { AgentInfo } from "./agents";
import type { InterviewQuestion } from "./types-settings";

// A short interview that designs the agent a project's issue cards are validated by
// (docs/architecture/github-issues.md). The user answers a handful of questions; Weft turns the
// answers into a soul — the first part of every system prompt the agent's threads get — and saves
// the agent, so it is pickable as the card's agent.
//
// It is a workflow, not a form: each answer shapes the next question, and the soul is written from
// the answers, not from a template with holes. A thread that knows the shape of a soul
// (lib/agent-author.ts) does the writing; this file is the brief it is handed.

export type { InterviewQuestion };

// The questions, in order. The first three are about the job; the last two are about the edges,
// which is where an agent's soul usually goes vague.
export const INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  {
    key: "checks",
    ask: "What should this agent check before the work starts?",
    hint: "The validation pass: what it reads first and what it decides.",
    options: [
      { value: "reproduce", label: "The bug reproduces", description: "It reproduces the issue before anything changes" },
      { value: "scope", label: "The issue is well-scoped", description: "The issue says enough to act on" },
      { value: "causes", label: "The cause is understood", description: "It finds why it happens, not just where" },
      { value: "safe", label: "The change is safe", description: "It checks the blast radius before touching anything" },
    ],
  },
  {
    key: "refuses",
    ask: "What should it refuse to do?",
    hint: "The line it does not cross, whatever the issue asks for.",
    options: [
      { value: "no-write", label: "Never change code", description: "It only reads and reports" },
      { value: "no-network", label: "Never call out", description: "It stays inside the repo" },
      { value: "no-guess", label: "Never guess", description: "It stops and asks rather than assume" },
      { value: "no-verify", label: "Never claim untested", description: "It never says it works without running it" },
    ],
  },
  {
    key: "shows",
    ask: "What should it leave behind?",
    hint: "How it shows its work, so you can judge the verdict.",
    options: [
      { value: "plan", label: "A plan", description: "The steps it would take, in order" },
      { value: "verdict", label: "A verdict", description: "One line: work it, or don't" },
      { value: "evidence", label: "Evidence", description: "The commands it ran and what they said" },
      { value: "diff", label: "A diff", description: "What it would change, without changing it" },
    ],
  },
  {
    key: "stops",
    ask: "When should it stop and ask you?",
    options: [
      { value: "always-when-unsure", label: "Whenever it is unsure", description: "It asks rather than choosing for you" },
      { value: "before-write", label: "Before it changes anything", description: "It reports first, writes after" },
      { value: "never", label: "Rarely", description: "It decides and tells you afterwards" },
    ],
  },
  {
    key: "name",
    ask: "What should it be called?",
    hint: "A short name in the title case, like Reviewer or Triage.",
  },
];

// The answers, keyed by the question's key.
export type InterviewAnswers = Record<string, string>;

// The name to save the agent under: the user's own name if they gave one, else one from the job.
export function interviewName(answers: InterviewAnswers): string {
  const said = answers.name?.trim();
  if (said) return said.length > 40 ? said.slice(0, 40) : said;
  return answers.checks === "reproduce" ? "Reproducer" : "Validator";
}

// The one line Settings shows under the agent's name.
export function interviewTagline(answers: InterviewAnswers): string {
  const checks = CHECKS[answers.checks ?? ""] ?? "whether the issue is worth working on";
  return `Checks ${checks} before the work starts`;
}

// One emoji for the agent, so it is recognisable on a card.
export function interviewEmoji(answers: InterviewAnswers): string {
  return answers.checks === "reproduce" ? "🔍" : "🛡️";
}

// The soul: the standing instructions the agent's threads get, written from the answers.
//
// It is instructions, not a description: "read the issue, then the code it names" tells the thread
// what to do, where "a careful validator" only tells it how to feel about it.
export function interviewSoul(answers: InterviewAnswers): string {
  const lines: string[] = [];
  lines.push(`You are the ${interviewName(answers)}, the agent that checks a GitHub issue before any work starts.`);
  lines.push("");
  lines.push("Your job is to decide whether the issue is worth working on, and to show your reasoning. You do not do the work itself.");
  lines.push("");
  lines.push("What you read first, in order:");
  lines.push("1. The issue: its title, its body, its labels, and the link to it.");
  lines.push("2. The repository, enough to see whether the issue's subject is really here: the code the issue names, and the tests that cover it.");
  lines.push(`3. ${CHECK_STEP[answers.checks ?? ""] ?? CHECK_STEP["scope"]}`);
  lines.push("");
  lines.push("What you make:");
  lines.push(`- ${SHOWS[answers.shows ?? ""] ?? SHOWS["verdict"]}`);
  lines.push("- A clear verdict: work it, or don't — with the one reason that decided it.");
  lines.push("");
  lines.push("What you must never do:");
  lines.push(`- ${REFUSES[answers.refuses ?? ""] ?? REFUSES["no-guess"]}`);
  lines.push("");
  lines.push("How you show your work:");
  lines.push("- The commands you ran and what they said, in the order you ran them.");
  lines.push("- The verdict and its reason, last, so it is the thing the reader remembers.");
  lines.push("");
  lines.push("When you are unsure or blocked:");
  lines.push(
    answers.stops === "never"
      ? "- You decide, and you say plainly what you assumed."
      : answers.stops === "before-write"
        ? "- You report what you found and stop before you change anything. Someone else decides."
        : "- You stop and ask, with the question that would unblock you and what you have ruled out so far.",
  );
  lines.push("");
  lines.push("Keep it brief. A verdict you can read in a minute beats a report you have to wade through.");
  return lines.join("\n");
}

// The line for each "what should it check" answer.
const CHECKS: Record<string, string> = {
  reproduce: "the bug reproduces",
  scope: "the issue is well-scoped",
  causes: "the cause is understood",
  safe: "the change is safe",
};

// The step each "what should it check" answer adds to what the agent reads.
const CHECK_STEP: Record<string, string> = {
  reproduce: "The reproduction: the failing test, or the command that shows the problem happening.",
  scope: "The gap between what the issue says and what the code does, so you know whether the ask is clear.",
  causes: "The cause: the code path that leads to the behaviour, until you can say why it happens.",
  safe: "The blast radius: everything else that touches the same code, and what a change there would break.",
};

// The line for each "what should it leave behind" answer.
const SHOWS: Record<string, string> = {
  plan: "The steps the work would take, in the order they would happen.",
  verdict: "One line: work it, or don't.",
  evidence: "The commands you ran and what each one said.",
  diff: "The change you would make, as a diff — without making it.",
};

// The lines for each "what should it refuse" answer.
const REFUSES: Record<string, string> = {
  "no-write": "Change any file. You read and report; someone else writes.",
  "no-network": "Call out to the network. You stay inside the repository you were given.",
  "no-guess": "Guess. If the issue does not say enough, you say so and stop.",
  "no-verify": "Say it works without running it. An unverified claim is not a verdict.",
};

// The agent the interview makes, saved so it is pickable in the drawer (lib/agent-store.ts).
export function saveInterviewedAgent(answers: InterviewAnswers): AgentInfo {
  return createAgent({
    name: interviewName(answers),
    soul: interviewSoul(answers),
    emoji: interviewEmoji(answers),
    tagline: interviewTagline(answers),
  });
}
