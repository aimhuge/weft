import { connection } from "next/server";
import { resolveFolder } from "@/lib/folders";
import { asText } from "@/lib/format";
import { removeHook } from "@/lib/github-hooks";
import { disableIssueSync, enableIssueSync, issueSyncFolders, issueSyncStatus, syncIssues } from "@/lib/github-issues";
import { fail, guard } from "@/lib/guard";
import { isIssueLanding, workflowOf } from "@/lib/issue-landing";
import { issueWorkflow, setIssueWorkflow } from "@/lib/settings";

// GitHub issues as cards (lib/github-issues.ts). GET lists the folders that sync and how their
// last sync went; POST { folder } syncs it now and keeps it syncing; PATCH { folder, landing } says
// where that folder's cards land; DELETE { folder } stops that.

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json({ folders: issueSyncFolders(), status: issueSyncStatus() });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const folder = resolveFolder(body.folder);
    // Synced first, so a folder with no GitHub remote isn't left polling.
    const counts = await syncIssues(folder);
    enableIssueSync(folder);
    return Response.json({ folder, ...counts });
  } catch (err) {
    return fail(err);
  }
}

// Where a folder's issue cards land: "backlog", "needs_you" or "run", plus the validation skill and
// the agent a "run" card works under (lib/issue-landing.ts). It changes where the next cards land;
// the ones already on the board stay where they are.
export async function PATCH(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const folder = resolveFolder(body.folder);
    const landing = body.landing;
    if (!isIssueLanding(landing)) throw new Error("Pick where the cards land: Backlog, Needs you or Run.");
    const skill = asText(body.skill).trim();
    const agent = asText(body.agent).trim();
    setIssueWorkflow(folder, workflowOf({ landing, skill, agent }));
    return Response.json({ folder, workflow: issueWorkflow(folder) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const folder = asText(body.folder).trim();
    if (!folder) throw new Error("Which folder should stop syncing its issues?");
    disableIssueSync(folder);
    // A webhook is no use without the sync; a failure to remove it leaves the sync off anyway.
    await removeHook(folder).catch((err: unknown) => console.warn(`GitHub webhook for ${folder}: ${(err as Error).message}`));
    return Response.json({ folders: issueSyncFolders() });
  } catch (err) {
    return fail(err);
  }
}
