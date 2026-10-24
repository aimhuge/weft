import { fail, guard } from "@/lib/guard";
import { resolveFolder } from "@/lib/folders";
import { ensureSpare, warmUp } from "@/lib/runner";
import type { Backend } from "@/lib/types";

// Starts CLIs ahead of time: a card's own (when its thread is opened) or a spare in a project
// folder (when a project is picked or the new-thread dialog opens).
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { cardId?: string; cwd?: string; backend?: Backend };
    if (body.cardId) warmUp(body.cardId);
    // Only Claude Code and puku-cli keep a warm spare; Codex and Goose start a fresh process
    // per turn, so there is nothing to keep warm. No backend named means Claude Code, which
    // is the default CLI.
    else if (body.cwd && body.backend !== "codex" && body.backend !== "goose") {
      ensureSpare(resolveFolder(body.cwd), body.backend === "puku" ? "puku" : "claude");
    }
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
