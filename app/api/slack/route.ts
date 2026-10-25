import { connection } from "next/server";
import { resolveFolder } from "@/lib/folders";
import { fail, guard } from "@/lib/guard";
import { syncFolders } from "@/lib/settings";
import { saveSlackSettings, slackSettings, type SlackSettingsPatch } from "@/lib/slack-store";
import type { SlackSettings } from "@/lib/slack-types";

// The Slack drawer's settings (lib/slack-store.ts): the channel, which updates go to it and the project Slack cards
// start in. GET reads them, PUT patches them. Both say whether that project syncs, since the weft.zip links in
// Slack messages need it. The tokens are main's (electron/slack.cjs), never here.

// folderSynced is the default project's; synced lists which of the default and mapped projects sync, so each row of
// the drawer can offer Turn on sync for its own.
function view(settings: SlackSettings) {
  const on = syncFolders();
  const folders = [settings.folder, ...settings.links.map((l) => l.folder)].filter((f): f is string => Boolean(f));
  return { settings, folderSynced: Boolean(settings.folder && on.includes(settings.folder)), synced: folders.filter((f) => on.includes(f)) };
}

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json(view(slackSettings()));
}

export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const patch = (await req.json()) as SlackSettingsPatch;
    // A folder must be a real one; null clears it.
    if (typeof patch.folder === "string") patch.folder = resolveFolder(patch.folder);
    if (Array.isArray(patch.links)) patch.links = patch.links.map((l) => ({ ...l, folder: resolveFolder(l.folder) }));
    return Response.json(view(saveSlackSettings(patch)));
  } catch (err) {
    return fail(err);
  }
}
