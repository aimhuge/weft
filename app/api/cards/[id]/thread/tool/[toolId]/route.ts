import { connection } from "next/server";
import { guard } from "@/lib/guard";
import { hostFail, runVerb } from "@/lib/host-api";

// The full result of a tool call whose inline result was trimmed (lib/cloud-sync-types.ts TOOL_RESULT_INLINE_MAX): the
// thread.tool verb (lib/host-api/thread.ts). The thread row fetches it when opened.
export async function GET(req: Request, { params }: { params: Promise<{ id: string; toolId: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const { id, toolId } = await params;
  return runVerb("thread.tool", { id, toolId }).then((r) => Response.json(r), (err: unknown) => hostFail(err));
}
