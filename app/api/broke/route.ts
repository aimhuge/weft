import { fail, guard } from "@/lib/guard";
import { recordBreak } from "@/lib/crash-blame";

// The board reports what it saw break Weft (lib/use-break-report.ts): a build error naming its file, or a full reload
// of the page. The server weighs it against every card's recent tool calls and marks the card that did it; the
// server's own deaths come from Electron instead (electron/server-exit.cjs). Answers the card it marked, or null.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as { kind?: unknown; at?: unknown; file?: unknown };
    if (body.kind !== "build" && body.kind !== "reload") throw new Error("kind must be build or reload.");
    const at = typeof body.at === "number" && Number.isFinite(body.at) ? body.at : Date.now();
    const file = typeof body.file === "string" && body.file ? body.file : undefined;
    if (body.kind === "build" && !file) throw new Error("A build error needs its file.");
    const card = recordBreak({ kind: body.kind, at, ...(file && { file }) });
    return Response.json({ card: card?.broke ? { id: card.id, broke: card.broke } : null });
  } catch (err) {
    return fail(err);
  }
}
