// The reply that goes with a question's answers: per-question notes and previews, or a "Chat about this"
// message that declines the question to talk it over instead. Lives here so the permission route
// (the app's app/api/cards/[id]/permission/route.ts) and the cloud-inbox answer command (./cloud-commands.ts)
// sanitize the untrusted body with the same rules — one copy of the logic, no drift.
import type { QuestionReply } from "./thread-items";

export function readQuestionReply(body: { annotations?: unknown; chat?: unknown }): QuestionReply | undefined {
  const reply: QuestionReply = {};
  if (body.annotations && typeof body.annotations === "object") {
    const annotations: NonNullable<QuestionReply["annotations"]> = {};
    for (const [question, value] of Object.entries(body.annotations as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const { notes, preview } = value as Record<string, unknown>;
      const note = {
        ...(typeof notes === "string" && notes.trim() ? { notes } : {}),
        ...(typeof preview === "string" && preview ? { preview } : {}),
      };
      if (Object.keys(note).length) annotations[question] = note;
    }
    if (Object.keys(annotations).length) reply.annotations = annotations;
  }
  if (typeof body.chat === "string" && body.chat.trim()) reply.chat = body.chat;
  return Object.keys(reply).length ? reply : undefined;
}
