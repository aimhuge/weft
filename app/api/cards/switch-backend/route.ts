import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { isBusy, switchBackend } from "@/lib/runner";
import { getCard } from "@/lib/store";
import { BACKEND_IDS } from "@/lib/new-thread";
import type { Backend } from "@/lib/types";

// Every CLI a card may be switched to. Shared (lib/new-thread.ts), so a CLI added there can be
// switched to here too — a switch to a CLI this list didn't know was refused.
const BACKENDS: Backend[] = BACKEND_IDS;

// Flip every in-flight card in a list to the other backend. Cards that are still running
// (busy) are returned in `pending` so the column button can confirm with the user before
// retrying (the per-card switch still refuses to switch a busy card, so the retry only
// succeeds once each turn ends). The per-card switch decides whether to replay the last
// user message (rate-limit cards) or just flip without replaying.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  await connection();
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (!Array.isArray(body.ids) || body.ids.length === 0) throw new Error("ids must be a non-empty list.");
    if (typeof body.backend !== "string" || !BACKENDS.includes(body.backend as Backend)) {
      throw new Error(`backend must be one of ${BACKENDS.join(", ")}.`);
    }
    const ids = body.ids.filter((x): x is string => typeof x === "string");
    const backend = body.backend as Backend;
    const switched: string[] = [];
    const failed: { id: string; error: string }[] = [];
    const pending: string[] = [];
    for (const id of ids) {
      const card = getCard(id);
      if (!card) { failed.push({ id, error: "no such card" }); continue; }
      if (isBusy(id)) { pending.push(id); continue; }
      try {
        await switchBackend(id, backend, { replay: Boolean(card.rateLimitHit) });
        switched.push(id);
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return Response.json({ switched, failed, pending });
  } catch (err) {
    return fail(err);
  }
}
