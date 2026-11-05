import { connection } from "next/server";
import { resolveFolder } from "@/lib/folders";
import { fail, guard } from "@/lib/guard";
import { setSyncFolder, syncFolders } from "@/lib/settings";
import { cloudSyncStatus, queueFolder, syncNow } from "@/lib/cloud-sync";
import { rememberSyncRepo } from "@/lib/cloud-sync-repos";

// The Settings → Sync page (lib/use-cloud-sync.ts, components/SyncSettings.tsx). GET returns which folders
// have sync turned on and how the last flush went; POST turns a folder on or off (and queues its cards when
// on) or asks for a flush right now ({ sync: true }).

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json({ folders: syncFolders(), status: cloudSyncStatus() });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (body.sync === true) {
      syncNow();
      return Response.json({ status: cloudSyncStatus() });
    }
    if (!("folder" in body)) return Response.json({ error: "Provide a folder or { sync: true }." }, { status: 400 });
    const folder = resolveFolder(body.folder);
    const on = body.on !== false;
    setSyncFolder(folder, on);
    // Turning a folder on also flushes its existing cards and items.
    if (on) queueFolder(folder);
    // Your other Macs follow the switch for their clone of the same repo; it never holds up the answer.
    rememberSyncRepo(folder, on).catch((err: unknown) => console.warn("[weft] project sync across Macs:", err));
    return Response.json({ folder, on, folders: syncFolders(), status: cloudSyncStatus() });
  } catch (err) {
    return fail(err);
  }
}
