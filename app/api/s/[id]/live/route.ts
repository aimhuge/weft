// GET /api/s/[id]/live — the share viewer's poll. Returns a ShareLive (lib/share-types.ts) for the
// page, then a slimmer shape for the periodic poll: items with seq > `after`, or items with seq <
// `before` for "Load earlier". Re-checks the access gate on every request so a revoked share stops
// answering. No localhost guard: the gate cookie is the check (lib/share-access.ts).
import { NO_STORE } from "@/lib/app-share-reply";
import { shareAccess } from "@/lib/share-access";
import { buildShareLive } from "@/lib/share-live";
import { serviceClient } from "@/lib/web-session";

// `Cache-Control: no-store` is important: a stale poll response would freeze the live view on
// whatever the server was showing at the time, defeating the whole point of the page.

function intParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && Math.floor(n) === n && n >= 0 ? n : undefined;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await shareAccess(id);
  if (access.kind !== "ok") return verdictResponse(access);
  const { card } = access.share;
  if (!card) return Response.json({ error: "missing" }, { status: 404, headers: NO_STORE });
  const url = new URL(req.url);
  const after = intParam(url, "after");
  const before = intParam(url, "before");
  const service = serviceClient();
  if (!service) return Response.json({ error: "unconfigured" }, { status: 503, headers: NO_STORE });
  const live = await buildShareLive({
    service,
    orgId: access.share.share.org_id,
    cardId: access.share.share.card_id,
    card: card.card,
    showChat: access.share.share.show_chat !== false,
    ...(typeof after === "number" ? { after } : {}),
    ...(typeof before === "number" ? { before } : {}),
  });
  return Response.json(live, { headers: NO_STORE });
}

// Map the access verdict to the right HTTP code: 401 for login, 403 for denied, 404 for missing,
// 503 for unconfigured. The gate case is a 403 too — the client should be looking at the page,
// not the API, and the page has rendered the gate form.
function verdictResponse(access: { kind: string }): Response {
  if (access.kind === "login") return Response.json({ error: "login" }, { status: 401, headers: NO_STORE });
  if (access.kind === "denied") return Response.json({ error: "denied" }, { status: 403, headers: NO_STORE });
  if (access.kind === "missing") return Response.json({ error: "missing" }, { status: 404, headers: NO_STORE });
  if (access.kind === "unconfigured") return Response.json({ error: "unconfigured" }, { status: 503, headers: NO_STORE });
  // "gate" is 403 with a header the client could read; today the page re-renders the form on
  // 403 because the API call shouldn't happen for a gated share until the gate is passed.
  return Response.json({ error: "gate" }, { status: 403, headers: NO_STORE });
}
