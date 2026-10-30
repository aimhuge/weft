import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { setWorkerFolder, workerFolders } from "@/lib/settings";
import { requireWorker } from "@/lib/worker-handoff";
import { commandResult, enrolToken, listWorkers, removeWorker, sendClone, sendGithubLogin, sendLogin, sendRun } from "@/lib/workers-account";

// Settings → Sync → Workers (components/WorkerSettings.tsx, lib/use-workers.ts): GET lists the workspace's Weft
// Workers, POST { action: "token" } makes a one-time enrolment token, POST { action: "run", workerId, folder,
// prompt, repo? } queues a run on one, POST { action: "folder", folder, on } switches a project's new cards to
// your worker or back to this machine (lib/worker-handoff.ts), POST { action: "login", workerId, token } sends a
// Claude token sealed to that worker (lib/worker-seal.ts), POST { action: "github", workerId, token } does the same
// for GitHub, POST { action: "clone", workerId, repo } queues a clone of owner/name, GET ?command= says how a command
// went, GET ?folders=1 lists the switched ones without asking Supabase, and DELETE ?id= removes one.

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const params = new URL(req.url).searchParams;
  if (params.has("folders")) return Response.json({ folders: workerFolders() });
  try {
    const command = params.get("command");
    return Response.json(command ? await commandResult(command) : await listWorkers());
  } catch (err) {
    return fail(err, 502);
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (key: string) => {
      const v = body[key];
      return typeof v === "string" ? v : "";
    };
    if (body.action === "token") return Response.json(await enrolToken());
    if (body.action === "folder") {
      const folder = str("folder");
      if (!folder.trim()) return Response.json({ error: "Choose a project." }, { status: 400 });
      // Switching on needs a worker of yours to send to; switching back never does.
      const worker = body.on === true ? (await requireWorker()).name : undefined;
      setWorkerFolder(folder, body.on === true);
      return Response.json({ folders: workerFolders(), worker });
    }
    if (body.action === "run") return Response.json(await sendRun({ workerId: str("workerId"), folder: str("folder"), prompt: str("prompt"), repo: str("repo") || undefined }));
    if (body.action === "login") return Response.json(await sendLogin({ workerId: str("workerId"), token: str("token") }));
    if (body.action === "github") return Response.json(await sendGithubLogin({ workerId: str("workerId"), token: str("token") }));
    if (body.action === "clone") return Response.json(await sendClone({ workerId: str("workerId"), repo: str("repo") }));
    return Response.json({ error: "Say token, run, login, github, clone or folder." }, { status: 400 });
  } catch (err) {
    return fail(err, 502);
  }
}

export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Provide the worker's id." }, { status: 400 });
  try {
    await removeWorker(id);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err, 502);
  }
}
