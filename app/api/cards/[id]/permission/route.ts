import { fail, elevated } from "@/lib/guard";
import { readQuestionReply } from "@/lib/question-reply";
import { putFirst } from "@/lib/precedence";
import { answerPermission, waitPermission } from "@/lib/runner";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = elevated(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const body = (await req.json()) as {
      allow?: boolean;
      // Wait: hold the edit until the card holding that code lets go (lib/permission-wait.ts).
      wait?: boolean;
      // Me first: go ahead, and the card holding that code yields the file (lib/precedence.ts).
      first?: boolean;
      answers?: Record<string, string>;
      pendingId?: string;
      annotations?: unknown;
      chat?: unknown;
    };
    const { allow, answers, pendingId } = body;
    if (body.first === true) {
      if (typeof pendingId !== "string") throw new Error("Me first needs the request's pendingId.");
      putFirst(id, pendingId);
      return Response.json({ ok: true });
    }
    if (body.wait === true) {
      if (typeof pendingId !== "string") throw new Error("Wait needs the request's pendingId.");
      waitPermission(id, pendingId);
      return Response.json({ ok: true });
    }
    answerPermission(
      id,
      allow === true,
      answers && typeof answers === "object" ? answers : undefined,
      typeof pendingId === "string" ? pendingId : undefined,
      readQuestionReply(body),
    );
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err, 409);
  }
}
