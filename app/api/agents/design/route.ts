import { briefPage } from "@/lib/agent-brief-page";
import { briefPrompt, briefTitle, type AgentBrief } from "@/lib/agent-thread";
import { elevated, fail } from "@/lib/guard";
import { createCardFromBody, startCard } from "@/lib/new-card";
import { defaultPermissionMode } from "@/lib/settings";
import { openShowFile, writeShowFile } from "@/lib/show";
import { getCard } from "@/lib/store";

// The GitHub drawer's "Design the agent" (docs/architecture/github-issues.md): a new thread of a
// special kind, which designs the agent that triages this project's issues.
//
// Weft does not ask the questions. The thread does: the drawer starts a thread with the brief
// ("design an agent for weft that triages GitHub issues"), and the thread asks the user what it
// needs and writes the soul from the answers.
//
// The thread's pane opens on the brief (lib/agent-brief-page.ts), so the page says what the
// thread is doing before the thread has said anything. Only Weft's own window may start it.

export async function POST(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { project?: unknown; job?: unknown; backend?: unknown };
    const project = typeof body.project === "string" ? body.project.trim() : "";
    if (!project) throw new Error("Say which project the agent is for.");
    const job = typeof body.job === "string" ? body.job.trim() : "";
    if (!job) throw new Error("Say what the agent is for, in a sentence.");

    const brief: AgentBrief = { project, job };
    const card = createCardFromBody({
      prompt: briefPrompt(brief),
      title: briefTitle(brief),
      cwd: project,
      backend: body.backend === "puku" || body.backend === "codex" || body.backend === "goose" ? body.backend : "claude",
      permissionMode: defaultPermissionMode(),
      tags: ["agent"],
    });

    // The thread's default show file: the brief it is running on. Written before the turn starts,
    // so the pane has the page when the thread opens rather than a blank scene — and the starter
    // scene leaves it alone (lib/show.ts).
    writeShowFile(card.id, briefPage(brief));

    const start = startCard(card);
    // Open the brief in the card's own pane, so the page is in front of you with the thread.
    await openShowFile(card.id).catch(() => {});
    return Response.json({ card: getCard(card.id), start });
  } catch (err) {
    return fail(err);
  }
}
