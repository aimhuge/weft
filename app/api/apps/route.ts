import { after } from "next/server";
import { dropCloudApp, pushApp, syncAppsSoon } from "@/lib/app-cloud";
import { dropAppShare } from "@/lib/app-share";
import { fail, guard } from "@/lib/guard";
import { listApps, removeApp, saveApp, updateApp } from "@/lib/mini-app-store";
import { saveWorkerPageApp } from "@/lib/mini-app-worker";
import { blobPageSha } from "@/lib/mini-apps";

// The apps sidebar's mini apps (lib/mini-app-store.ts): pages from the browser pane saved as apps.
// Saves, renames, moves and removes also push to prod (lib/app-cloud.ts); the push runs after the
// response, so it can never block the local save.

type Body = { id?: unknown; url?: unknown; name?: unknown; to?: unknown };

export function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  // A throttled background pull so a Mac that lacks an app saved elsewhere eventually gets it.
  syncAppsSoon();
  return Response.json({ apps: listApps() });
}

// { url, name? }: saves the page as an app (or renames the app it already is). url may be a worker card's blob page.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Body;
    // A worker card's page comes home first (lib/mini-app-worker.ts); anything else is saved by its address.
    const app = blobPageSha(body.url) ? await saveWorkerPageApp(body.url, body.name) : saveApp(body.url, body.name);
    after(() => pushApp(app));
    return Response.json({ app });
  } catch (err) {
    return fail(err);
  }
}

// { id, name?, to? }: renames it, or moves it to place `to`.
export async function PATCH(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Body;
    const app = updateApp(body.id, { name: body.name, to: body.to });
    after(() => pushApp(app));
    return Response.json({ app });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Body;
    const app = listApps().find((a) => a.id === body.id);
    removeApp(body.id);
    // Its share link goes with it; the app is gone either way.
    await dropAppShare(app).catch(() => {});
    after(() => dropCloudApp(String(body.id)));
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
