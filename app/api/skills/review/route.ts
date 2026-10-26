import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { pluginInstalls } from "@/lib/skill-library";
import { SKILL_ID } from "@/lib/skill-registry";
import { localTarget, remoteTarget, reviewState, startReview, type ReviewTarget } from "@/lib/skill-review";

// A skill's AI review (lib/skill-review.ts): { id, hash? } for one from skills.sh (previewed first, so Weft
// has a copy), { cwd, name } for one you have, a plugin by its id. GET reads where it stands; POST starts one
// unless it's kept or running, writes its page, and answers at once with the page to open in the pane.

function targetFor(where: { id?: unknown; hash?: unknown; cwd?: unknown; name?: unknown }): ReviewTarget | undefined {
  if (typeof where.id === "string" && SKILL_ID.test(where.id)) return remoteTarget(where.id, typeof where.hash === "string" && where.hash ? where.hash : undefined);
  if (typeof where.name !== "string" || !where.name) return undefined;
  const cwd = typeof where.cwd === "string" && where.cwd ? where.cwd : undefined;
  const plugin = where.name.includes("@") ? pluginInstalls().find((p) => p.id === where.name)?.installPath : undefined;
  return localTarget(cwd, where.name, plugin || undefined);
}

const NOT_FOUND = { error: "Weft has no copy of that skill. Preview it first." };

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const target = targetFor(Object.fromEntries(new URL(req.url).searchParams));
    if (!target) return Response.json(NOT_FOUND, { status: 404 });
    return Response.json(reviewState(target));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const target = targetFor((await req.json()) as Record<string, unknown>);
    if (!target) return Response.json(NOT_FOUND, { status: 404 });
    return Response.json(startReview(target));
  } catch (err) {
    return fail(err);
  }
}
