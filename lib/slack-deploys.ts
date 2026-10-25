import { shell } from "./browser-tools";
import { deployMessage, type DeployInfo } from "./slack-messages";
import type { VercelStatus } from "./vercel-view";

// Deploys for Slack (docs/architecture/slack.md): Weft deploys by pushing to a Vercel-linked repo, so a deploy is
// whatever Vercel builds next. Each look asks main for the board folders' latest deployment (control route
// POST /vercel/status, the drawer's own read) and posts a deployment once, when it ends READY, ERROR or CANCELED.
// A deployment that had already ended on the first look is never posted; one still building then is, when it ends.

const DONE = new Set(["READY", "ERROR", "CANCELED"]);

interface Seen {
  createdAt: number;
  posted: boolean;
}

// `post` gets the folder too, so a project with its own channel hears about its own deploys.
export function createDeployWatch(post: (message: ReturnType<typeof deployMessage>, folder: string) => void) {
  // Per Vercel project: two folders linked to one project are one deploy.
  const seen = new Map<string, Seen>();

  async function tick(folders: string[]) {
    if (!folders.length) return;
    const status = (await shell("/vercel/status", { folders })) as unknown as Partial<VercelStatus>;
    for (const f of status.folders ?? []) {
      const d = f.link?.latest;
      if (!f.link || !d) continue;
      const key = f.link.projectId;
      const before = seen.get(key);
      const ended = DONE.has(d.state);
      if (!before) {
        seen.set(key, { createdAt: d.createdAt, posted: ended });
        continue;
      }
      const entry = before.createdAt === d.createdAt ? before : { createdAt: d.createdAt, posted: false };
      seen.set(key, entry);
      if (!ended || entry.posted) continue;
      entry.posted = true;
      const info: DeployInfo = { project: f.link.name ?? key, state: d.state, target: d.target, url: d.url, page: d.page ?? null };
      post(deployMessage(info), f.folder);
    }
  }

  return { tick };
}
