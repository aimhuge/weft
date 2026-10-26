import { createAgent, listAgents, projectAgents, setProjectAgent } from "@/lib/agent-store";
import { elevated, fail, guard } from "@/lib/guard";

// Settings → Agents (docs/architecture/agents.md): every agent, built-ins first, and each project's default; a new one of
// your own (POST), or a project's default (PUT { cwd, agent }, null for Builder).
// A soul is a system prompt, so only Weft's own window may write one, never a thread's curl.

export function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  return Response.json({ agents: listAgents(), projects: projectAgents() });
}

export async function POST(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    return Response.json({ agent: createAgent((await req.json()) as Record<string, unknown>) });
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { cwd?: unknown; agent?: unknown };
    setProjectAgent(typeof body.cwd === "string" ? body.cwd : "", typeof body.agent === "string" ? body.agent : null);
    return Response.json({ projects: projectAgents() });
  } catch (err) {
    return fail(err);
  }
}
