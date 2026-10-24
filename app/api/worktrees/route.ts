import { fail, guard } from "@/lib/guard";
import { warmPool } from "@/lib/worktree-pool";

// The New thread dialog's Isolated switch went on: warm the folder's repo's worktree pool (lib/worktree-pool.ts), so
// the card takes a ready worktree when you press Start. Answers at once; the fill runs in the background.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { cwd } = (await req.json()) as { cwd?: unknown };
    if (typeof cwd !== "string" || !cwd.startsWith("/")) throw new Error("cwd must be an absolute path.");
    void warmPool(cwd);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err, 400);
  }
}
