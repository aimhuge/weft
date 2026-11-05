import { connection } from "next/server";
import { elevated, fail } from "@/lib/guard";
import { answerHandover } from "@/lib/handover";

// Your answer to a teammate's ask for one of your cards (lib/handover.ts): POST { card, yes } — yes stops the card,
// pushes its work to a branch and tells them which; no says not now. It pushes your code, so only Weft's own window
// may ask (lib/guard.ts elevated), never a thread's curl.
export async function POST(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  await connection();
  const body = (await req.json().catch(() => ({}))) as { card?: unknown; yes?: unknown };
  if (typeof body.card !== "string" || !body.card) return Response.json({ error: "Which card?" }, { status: 400 });
  if (typeof body.yes !== "boolean") return Response.json({ error: "Yes or no?" }, { status: 400 });
  try {
    return Response.json(await answerHandover(body.card, body.yes));
  } catch (err) {
    return fail(err, 400);
  }
}
