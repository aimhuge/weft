import { connection } from "next/server";
import { elevated, fail } from "@/lib/guard";
import { macSync, type Target } from "@/lib/mac-tree-sync";

// Synced folders (docs/architecture/folder-sync.md). The board window holds the session line to the worker and pumps the
// `tree` channel through here, where this Mac's peer runs on its checkout (lib/mac-tree-sync.ts):
//   POST { op: "open" | "opened" | "in" | "out" | "close" | "status" | "lead", workerId, folder, workerName?, texts? }
// and turns sync on or off for a folder through main (Touch ID to turn on, electron/tree-sync-sign.cjs):
//   POST { op: "enable" | "disable" | "list", workerId?, folder?, workerName? }
// It writes into this Mac's working tree and has main sign for the worker's, so only Weft's own window may ask
// (lib/guard.ts elevated), never a thread's curl.
type Body = { op?: unknown; workerId?: unknown; folder?: unknown; workerName?: unknown; texts?: unknown };

const MAX_TEXTS = 500;

function targetOf(body: Body): Target | null {
  if (typeof body.workerId !== "string" || !body.workerId || typeof body.folder !== "string" || !body.folder) return null;
  return { workerId: body.workerId, folder: body.folder, ...(typeof body.workerName === "string" ? { workerName: body.workerName.slice(0, 60) } : {}) };
}

const shell = async (route: string, body: Record<string, unknown>) => (await import("@/lib/browser-shell")).shell(route, body);

export async function POST(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  await connection();
  const body = (await req.json().catch(() => ({}))) as Body;
  const sync = macSync();
  try {
    if (body.op === "list") return Response.json(await shell("/tree-sync/list", {}));
    const t = targetOf(body);
    if (!t) return Response.json({ error: "Which worker, and which project?" }, { status: 400 });
    switch (body.op) {
      case "enable":
        return Response.json(await shell("/tree-sync/enable", { workerId: t.workerId, folder: t.folder, workerName: t.workerName }));
      case "disable":
        sync.close(t);
        return Response.json(await shell("/tree-sync/disable", { workerId: t.workerId, folder: t.folder }));
      case "open":
        return Response.json({ open: await sync.open(t) });
      case "opened":
        await sync.opened(t);
        return Response.json({ ok: true });
      case "in": {
        const texts = Array.isArray(body.texts) ? body.texts.filter((x): x is string => typeof x === "string").slice(0, MAX_TEXTS) : [];
        sync.receive(t, texts);
        return Response.json({ ok: true });
      }
      case "out":
        return Response.json(await sync.out(t));
      case "close":
        sync.close(t);
        return Response.json({ ok: true });
      case "status":
        return Response.json({ status: sync.status(t) });
      case "lead":
        sync.lead(t);
        return Response.json({ ok: true });
      default:
        return Response.json({ error: "No such step." }, { status: 400 });
    }
  } catch (err) {
    return fail(err, 400);
  }
}
