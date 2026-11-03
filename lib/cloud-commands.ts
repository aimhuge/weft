// Commands the weft.zip board sends to a Mac (public.cloud_commands, supabase/migrations/*_card_commands.sql). The
// shapes, the builders the boards use and the readers that need nothing of the Mac live in @weft/client
// (packages/weft-client/src/cloud-commands.ts); this is the Mac's side: the model lists a new card's CLI is read
// from, the new card's request body (with who asked) and the folder an answer grants.
import {
  GRANT_SCOPES,
  isNewCardMode,
  newCardCommand as clientNewCardCommand,
  type Backend,
  type CloudCommandRow,
  type AnswerPayload,
  type GrantScope,
  type NewCardForm,
  type NewCardPayload,
  type NewCommand,
} from "@weft/client";
import { backendFor, CODEX_DEFAULT_MODEL } from "./new-thread";
import type { PendingPermission } from "./types";
import { commandClient } from "./turn-client";

export {
  answerBody,
  answerCommand,
  commandText,
  isOpenCommand,
  NEW_CARD_MODES,
  replyBody,
  replyCommand,
  stopBody,
  stopCommand,
  type AnswerPayload,
  type ClonePayload,
  type CloudCommandKind,
  type CloudCommandRow,
  type CloudCommandStatus,
  type InputPayload,
  type LinePayload,
  type LoginPayload,
  type ModePayload,
  type NewCardForm,
  type NewCardMode,
  type NewCardPayload,
  type NewCommand,
  type PinPayload,
  type QaPayload,
  type ReplyPayload,
  type StopPayload,
  type UpdatePayload,
} from "@weft/client";

// How far an Allow on an outside-folder prompt reaches: this card, or every card on the machine running it. The
// signed message carries it too, so it lives with the approval shapes in @weft/client.
export { GRANT_SCOPES, type GrantScope };

function backendOf(model: string): Backend | undefined {
  return model === CODEX_DEFAULT_MODEL ? "codex" : backendFor(model);
}

// The row the web inserts for a new card, or null when there is nothing to run (an empty prompt).
export function newCardCommand(target: { orgId: string; device: string; folder: string }, form: NewCardForm): NewCommand | null {
  return clientNewCardCommand(target, form, backendOf);
}

const text = (v: unknown) => (typeof v === "string" ? v : undefined);

// The request body POST /api/cards takes (lib/new-card.ts), from a command as a Mac reads it. The payload came
// off the network, so only the fields a new card is made from are carried over, each as the type it must be.
export function newCardBody(command: Pick<CloudCommandRow, "folder" | "payload">): Record<string, unknown> {
  // The payload came off the network, so whatever the type says, it is checked here.
  const raw: unknown = command.payload;
  const p: Partial<Record<keyof NewCardPayload, unknown>> = raw && typeof raw === "object" ? raw : {};
  return {
    prompt: text(p.prompt),
    title: text(p.title),
    backend: text(p.backend),
    model: text(p.model),
    effort: text(p.effort),
    tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === "string") : undefined,
    // Only a mode a new card may start in, and only when it names one; Backlog only when it asks for it.
    ...(isNewCardMode(p.permissionMode) ? { permissionMode: p.permissionMode } : {}),
    ...(p.start === false ? { start: false } : {}),
    cwd: command.folder,
    // Who asked, for the first turn's <weft-env> block (lib/turn-client.ts): a hint, never a check.
    client: commandClient(raw),
  };
}

// The folder an answer grants, read from the request waiting on this machine, or null when it grants none. Throws
// rather than fall back to Allow once: the human asked for a grant, and one that can't be given leaves the prompt up.
// Only a tool's outside-folder prompt qualifies: a question's folder is guessed from the model's words, and a
// question's answers skip the signed-approval rule (lib/approval-check.ts), so it must not buy a standing grant.
export function answerGrant(answer: AnswerPayload, pending: PendingPermission | null | undefined): { directory: string; scope: GrantScope } | null {
  if (!answer.grant) return null;
  if (pending?.id !== answer.pendingId) throw new Error("That request isn't waiting anymore.");
  const directory = pending.questions || pending.elicitation ? undefined : pending.readScope?.directory;
  if (!directory) throw new Error("That request has no folder to allow.");
  return { directory, scope: answer.grant };
}
