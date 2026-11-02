import { connection } from "next/server";
import { resolveFolder } from "@/lib/folders";
import { fail, guard } from "@/lib/guard";
import { relaySignedIn } from "@/lib/webhook-forward";
import { addWebhook, listWebhooks } from "@/lib/webhooks";
import { workerLists } from "@/lib/worker-lists-read";

// The 🪝 drawer's webhooks (lib/webhooks.ts). GET ?folder=a&folder=b lists those projects' webhooks (all of them with no
// folder) and says whether this Weft is signed in to get public relay URLs; POST { folder, name, target, ... } adds one.

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const folders = new URL(req.url).searchParams.getAll("folder");
    const signedIn = await relaySignedIn().catch(() => false);
    // A Weft Worker's webhooks live on it and come from what it publishes, on its worker:// project paths.
    const remote = (await workerLists()).webhooks.filter((h) => !folders.length || folders.includes(h.folder));
    return Response.json({ hooks: [...listWebhooks(folders.length ? folders : undefined), ...remote], signedIn });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const folder = resolveFolder(body.folder);
    return Response.json(addWebhook({ folder, name: body.name as string, target: body.target as string, events: body.events as string[], hint: body.hint as string, secret: body.secret as string }));
  } catch (err) {
    return fail(err);
  }
}
