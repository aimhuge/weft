// GET /api/worker-board/page/[sha] — the iframe src for a worker card's page on the desktop board
// (components/WorkerOpenCard.tsx, lib/worker-board.ts workerPage). The web board's page route, on this Mac's server,
// read as the signed-in account so RLS is the gate.
//
// One thing is stricter here. The frame sits in the board window's session, and a page from a worker is untrusted.
// Electron keeps the launch token out of frames (electron/api-token.cjs) and gives this route alone the plain read
// value, which is what lets the frame load. Its CSP names no http: source too: the page can't fetch, post a form to,
// or load anything from 127.0.0.1. The sandbox is the frame's own as well, with no popups or forms.
import { connection } from "next/server";
import { NO_STORE } from "@/lib/app-share-reply";
import { fail, guard } from "@/lib/guard";
import { workerPage } from "@/lib/worker-board";

const SHA_RE = /^[0-9a-f]{64}$/;

const PAGE_CSP = "sandbox allow-scripts; default-src https: data: blob: 'unsafe-inline' 'unsafe-eval'; form-action 'none'; base-uri 'none'";

const HEADERS = { "Content-Security-Policy": PAGE_CSP, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=300" } as const;

export async function GET(req: Request, ctx: { params: Promise<{ sha: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const { sha } = await ctx.params;
  if (!SHA_RE.test(sha)) return new Response("Bad request", { status: 400, headers: NO_STORE });
  try {
    const got = await workerPage(sha);
    if (!got) return new Response("Not found", { status: 404, headers: NO_STORE });
    return new Response(got.body, { status: 200, headers: { ...HEADERS, "Content-Type": got.type } });
  } catch (err) {
    return fail(err, 502);
  }
}
