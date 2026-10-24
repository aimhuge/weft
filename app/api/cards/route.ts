import os from "node:os";
import { connection } from "next/server";
import { prewarm } from "@/lib/copilot";
import { elevated, fail, guard } from "@/lib/guard";
import { projectRoot } from "@/lib/repos";
import { createCardFromBody, startCard } from "@/lib/new-card";
import { listProjects } from "@/lib/settings";
import { getCard, listCards } from "@/lib/store";

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  prewarm();
  // The copilot is a thread too, but it has its own window.
  const cards = listCards().filter((c) => c.role !== "copilot");
  // Worktree folders -> their main repo, so the project bar folds them into it.
  const roots: Record<string, string> = {};
  for (const folder of new Set([...cards.map((c) => c.cwd), ...listProjects().map((p) => p.path)])) {
    const root = projectRoot(folder);
    if (root !== folder) roots[folder] = root;
  }
  return Response.json({ cards, home: os.homedir(), roots });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    // A thread may create cards with its curl, but not cards that ask less than the default (lib/guard.ts elevated).
    const loose = body.permissionMode !== undefined && body.permissionMode !== "default" ? elevated(req) : null;
    if (loose) return loose;
    const card = createCardFromBody(body);
    // A card whose model or CLI is at its limit waits for the window instead of failing its first
    // turn (lib/start-gate.ts); the answer says when its first message goes out.
    const start = body.start ? startCard(card) : { started: false };
    return Response.json({ card: getCard(card.id), start });
  } catch (err) {
    return fail(err);
  }
}
