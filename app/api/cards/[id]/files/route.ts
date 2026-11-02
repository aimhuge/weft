// GET/PUT /api/cards/<id>/files — the editor column's server side (lib/file-access.ts). Reads
// a file, stats it, gets the git HEAD version for the diff, lists the card's folder for ⌘P,
// and writes a file that refuses to overwrite when its baseHash doesn't match.

import { FileAccessError, headOf, listFiles, readFile, statFile, writeFile } from "@/lib/file-access";
import { elevated, fail, guard } from "@/lib/guard";
import { getCard } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

// The four GET modes the brief defines. The dispatch table is the only thing each op
// shares; paths are checked per op so a "list" doesn't take a path and the others do.
// An empty `op` is the plain read, which is the default when the URL has no op.
const GET_OPS: Record<string, (cwd: string, filePath: string) => Promise<unknown>> = {
  "": (cwd, p) => readFile(cwd, p).then((file) => ({ file })),
  read: (cwd, p) => readFile(cwd, p).then((file) => ({ file })),
  stat: (cwd, p) => statFile(cwd, p).then((stat) => ({ stat })),
  head: (cwd, p) => headOf(cwd, p),
};

export async function GET(req: Request, { params }: Ctx) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  const { id } = await params;
  try {
    const card = getCard(id);
    if (!card) return fail("No such card.", 404);
    const url = new URL(req.url);
    const op = url.searchParams.get("op") ?? "";
    const filePath = url.searchParams.get("path") ?? "";
    if (op === "list") {
      if (filePath) return fail("list takes no path.", 400);
      return Response.json({ files: await listFiles(card.cwd) });
    }
    const handler = GET_OPS[op];
    if (!handler) return fail(`Unknown op: ${op}`, 400);
    if (!filePath) return fail("path is required.", 400);
    return Response.json(await handler(card.cwd, filePath));
  } catch (err) {
    if (err instanceof FileAccessError) return fail(err, 400);
    return fail(err);
  }
}

// A save writes the folder, so it takes Weft's own window (lib/host-api's files.write is elevated too): the editor
// sends the launch token; a thread's curl, which can write files itself, has no use for it.
export async function PUT(req: Request, { params }: Ctx) {
  const denied = elevated(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const card = getCard(id);
    if (!card) return fail("No such card.", 404);
    const body = (await req.json()) as { path?: unknown; text?: unknown; baseHash?: unknown };
    if (typeof body.path !== "string" || typeof body.text !== "string") return fail("path and text are required.", 400);
    if (body.baseHash !== undefined && body.baseHash !== null && typeof body.baseHash !== "string") {
      return fail("baseHash must be a string, null, or omitted.", 400);
    }
    const out = await writeFile(card.cwd, body.path, body.text, body.baseHash);
    if ("conflict" in out) return Response.json({ error: "File changed on disk.", current: out.conflict }, { status: 409 });
    return Response.json({ result: out.result });
  } catch (err) {
    if (err instanceof FileAccessError) return fail(err, 400);
    return fail(err);
  }
}