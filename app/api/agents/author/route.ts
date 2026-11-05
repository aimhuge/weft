import { agentAuthorPrompt } from "@/lib/agent-author";
import { elevated, fail } from "@/lib/guard";
import { createCardFromBody, startCard } from "@/lib/new-card";
import { defaultPermissionMode } from "@/lib/settings";
import { getCard } from "@/lib/store";

// Settings → Agents → "Build it with a thread" (docs/architecture/agents.md): a card on the board that writes an
// agent's soul and saves it, so an agent is authored by a thread that knows the shape of a soul instead of typed
// into a text box by hand.
//
// The card is a normal thread: it runs on the user's own CLI, with their own folder and permission mode, and it
// writes the agent with the create_agent tool (lib/agent-tools.ts). Only Weft's own window may start it.

export async function POST(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { what?: unknown; cwd?: unknown; backend?: unknown };
    const what = typeof body.what === "string" ? body.what.trim() : "";
    if (!what) throw new Error("Say what the agent is for, in a sentence.");
    if (what.length > 2000) throw new Error("Keep the brief to a sentence or two.");

    // The thread runs where the user works; without a folder, the home folder, which every thread can read.
    const cwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim() : "";
    const card = createCardFromBody({
      prompt: agentAuthorPrompt(what),
      title: "Write an agent",
      cwd,
      backend: body.backend === "puku" || body.backend === "codex" || body.backend === "goose" ? body.backend : "claude",
      permissionMode: defaultPermissionMode(),
      tags: ["agent"],
    });
    const start = startCard(card);
    return Response.json({ card: getCard(card.id), start });
  } catch (err) {
    return fail(err);
  }
}
