import { fail, guard } from "@/lib/guard";
import { warmPool } from "@/lib/worktree-pool";
import { listBranches, repoRootOf } from "@/lib/worktrees";

const folderOf = (cwd: unknown): string => {
  if (typeof cwd !== "string" || !cwd.startsWith("/")) throw new Error("cwd must be an absolute path.");
  return cwd;
};

// The New thread dialog's branch picker (components/IsolateMenu.tsx): the folder's repo's local branches, newest commit
// first, each with the worktree it's checked out in (git won't check one out twice). None outside git.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const root = await repoRootOf(folderOf(new URL(req.url).searchParams.get("cwd")));
    return Response.json({ root: root ?? null, branches: root ? await listBranches(root) : [] });
  } catch (err) {
    return fail(err, 400);
  }
}

// The New thread dialog's Isolated switch went on: warm the folder's repo's worktree pool (lib/worktree-pool.ts), so
// the card takes a ready worktree when you press Start. Answers at once; the fill runs in the background.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { cwd } = (await req.json()) as { cwd?: unknown };
    void warmPool(folderOf(cwd));
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err, 400);
  }
}
