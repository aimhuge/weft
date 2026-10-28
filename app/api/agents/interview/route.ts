import { INTERVIEW_QUESTIONS, saveInterviewedAgent, type InterviewAnswers } from "@/lib/agent-interview";
import { fail, guard } from "@/lib/guard";

// The interview that designs the agent a project's issue cards are validated by
// (docs/architecture/github-issues.md). GET asks the questions; POST takes the answers and saves
// the agent, so it can be picked as the card's agent straight away.

export function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  return Response.json({ questions: INTERVIEW_QUESTIONS });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { answers?: unknown };
    const answers = readAnswers(body.answers);
    if (!answers.checks) throw new Error("Say what the agent should check before the work starts.");
    const agent = saveInterviewedAgent(answers);
    return Response.json({ agent });
  } catch (err) {
    return fail(err);
  }
}

// The answers, keyed by the question's key, keeping only the questions the interview asks.
function readAnswers(value: unknown): InterviewAnswers {
  const out: InterviewAnswers = {};
  if (!value || typeof value !== "object") return out;
  for (const question of INTERVIEW_QUESTIONS) {
    const answer = (value as Record<string, unknown>)[question.key];
    if (typeof answer === "string" && answer.trim()) out[question.key] = answer.trim();
  }
  return out;
}
