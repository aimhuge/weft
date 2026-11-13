import { connection } from "next/server";
import { starRepo, starStatus } from "@/lib/github-star";
import { guard } from "@/lib/guard";

// The "Enjoying Weft?" ask (components/StarPrompt.tsx, lib/star-prompt.ts): GET says whether you've starred Weft's repo
// ({ starred: true | false | null }, null when gh can't tell); POST stars it through gh ({ ok }).

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json({ starred: await starStatus() });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json({ ok: await starRepo() });
}
