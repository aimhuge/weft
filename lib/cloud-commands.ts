// Commands the weft.zip board sends to a Mac (public.cloud_commands, supabase/migrations/*_card_commands.sql).
// Four kinds: start a card in a synced folder (`newCardCommand` → `newCardBody`), reply to a card's thread
// (`replyCommand` → `replyBody`), answer a thread's pending permission or question (`answerCommand` → `answerBody`),
// and stop a card's running turn (`stopCommand` → `stopBody`). The web builds the row, the Mac (lib/cloud-inbox.ts)
// reads the payload back; all four live here so the two sides can't drift.
import { backendFor, CODEX_DEFAULT_MODEL } from "./new-thread";
import type { Sealed } from "./worker-seal";
import type { ApprovalAuth } from "./approval-sig";
import { readQuestionReply } from "./question-reply";
import type { QuestionReply } from "./types-thread";
import type { Backend, Effort, PendingPermission } from "./types";

export type CloudCommandStatus = "pending" | "claimed" | "done" | "failed";

// What a new card is made from. Not the permission mode: the Mac uses its own default, so the web can't ask
// for a thread that runs without asking.
export interface NewCardPayload {
  prompt: string;
  title?: string;
  backend?: Backend;
  model?: string;
  effort?: Effort | "";
  tags?: string[];
}

// A message typed into a card's thread on the web, for the Mac that runs the card to send as if typed there.
export interface ReplyPayload {
  cardId: string;
  text: string;
}

// How far an Allow on an outside-folder prompt reaches: this card, or every card on the machine running it.
export const GRANT_SCOPES = ["card", "always"] as const;
export type GrantScope = (typeof GRANT_SCOPES)[number];

// An answer to a card's pending permission request or question: the pendingId ties the answer to the
// request the user saw (otherwise the oldest is answered), allow vs. deny, the question's answers, and
// the same reply (notes per question / "Chat about this") the permission route carries.
export interface AnswerPayload {
  cardId: string;
  pendingId: string;
  allow: boolean;
  answers?: Record<string, string>;
  reply?: QuestionReply;
  // This card / Always on an outside-folder prompt. A scope and never a path: the machine running the card takes the
  // folder from its own pending request (answerGrant), so a command can only grant what the prompt on screen asked for.
  grant?: GrantScope;
  // A paired phone's signature over this answer (lib/approval-sig.ts, docs/architecture/mobile-security.md); the Mac
  // checks it in lib/approval-check.ts and reads it off the raw payload, never from answerBody.
  auth?: ApprovalAuth;
}

// A request to stop a card's running turn.
export interface StopPayload {
  cardId: string;
}

// A Claude Code token sealed to one Weft Worker (lib/worker-seal.ts); only that worker can open it.
export interface LoginPayload {
  token: Sealed;
}

// A GitHub repo to put on a Weft Worker, with no thread.
export interface ClonePayload {
  repo: string;
}

// "run", "login", "github_login" and "clone" go to a Weft Worker, never a Mac: their payloads and readers are
// lib/worker-commands.ts.
// A worker's card: the thread's mode picker, and a tap or swipe on its live screen (lib/worker-commands.ts).
export interface ModePayload {
  cardId: string;
  mode: string;
}

export interface InputPayload {
  cardId: string;
  kind: "tap" | "swipe";
  device: string;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  ms?: number;
}

export type CloudCommandKind = "new_card" | "reply" | "answer" | "stop" | "run" | "login" | "github_login" | "clone" | "mode" | "input";

// public.cloud_commands.
export interface CloudCommandRow {
  id: string;
  org_id: string;
  created_by: string;
  kind: CloudCommandKind;
  // The Mac that runs it (cloud_cards.owner_device) and the folder it runs in (cloud_cards.folder).
  target_device: string;
  folder: string;
  payload: NewCardPayload | ReplyPayload | AnswerPayload | StopPayload | LoginPayload | ClonePayload | ModePayload | InputPayload;
  status: CloudCommandStatus;
  card_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// The columns a client may set when it inserts a command (the rest are the database's).
export type NewCommand = Pick<CloudCommandRow, "org_id" | "kind" | "target_device" | "folder" | "payload">;

// A command is still on its way: the web board shows it until its card turns up.
export const isOpenCommand = (c: Pick<CloudCommandRow, "status">) => c.status === "pending" || c.status === "claimed";

// What the web board's New thread dialog collects.
export interface NewCardForm {
  prompt: string;
  // A model id from MODELS ("" or absent: the CLI's own default). It also says which CLI runs the card.
  model?: string;
  effort?: Effort | "";
}

function backendOf(model: string): Backend | undefined {
  return model === CODEX_DEFAULT_MODEL ? "codex" : backendFor(model);
}

// The row the web inserts for a new card, or null when there is nothing to run (an empty prompt).
export function newCardCommand(target: { orgId: string; device: string; folder: string }, form: NewCardForm): NewCommand | null {
  const prompt = form.prompt.trim();
  if (!prompt) return null;
  const payload: NewCardPayload = { prompt };
  const backend = form.model ? backendOf(form.model) : undefined;
  if (form.model && backend) {
    payload.backend = backend;
    payload.model = form.model;
  }
  if (form.effort) payload.effort = form.effort;
  return { org_id: target.orgId, kind: "new_card", target_device: target.device, folder: target.folder, payload };
}

// The row the web inserts to reply to a card, addressed to the Mac and folder the card runs in; null for an empty reply.
export function replyCommand(target: { orgId: string; device: string; folder: string; cardId: string }, text: string): NewCommand | null {
  const message = text.trim();
  if (!message) return null;
  return { org_id: target.orgId, kind: "reply", target_device: target.device, folder: target.folder, payload: { cardId: target.cardId, text: message } };
}

// The row the web inserts to answer a card's pending permission request or question, addressed to the Mac and
// folder the card runs in; null when the request is missing the pendingId it has to carry.
export function answerCommand(
  target: { orgId: string; device: string; folder: string; cardId: string },
  body: { pendingId: string; allow: boolean; answers?: Record<string, string>; reply?: QuestionReply; grant?: GrantScope },
): NewCommand | null {
  if (!body.pendingId) return null;
  const payload: AnswerPayload = { cardId: target.cardId, pendingId: body.pendingId, allow: body.allow };
  if (body.answers) payload.answers = body.answers;
  if (body.reply) payload.reply = body.reply;
  if (body.allow && body.grant) payload.grant = body.grant;
  return { org_id: target.orgId, kind: "answer", target_device: target.device, folder: target.folder, payload };
}

// The row the web inserts to stop a card's running turn.
export function stopCommand(target: { orgId: string; device: string; folder: string; cardId: string }): NewCommand {
  return { org_id: target.orgId, kind: "stop", target_device: target.device, folder: target.folder, payload: { cardId: target.cardId } };
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
    cwd: command.folder,
  };
}

// A reply as a Mac reads it off the network: the card and the text, or null when either is missing.
export function replyBody(command: Pick<CloudCommandRow, "payload">): ReplyPayload | null {
  const raw: unknown = command.payload;
  const p: Partial<Record<keyof ReplyPayload, unknown>> = raw && typeof raw === "object" ? raw : {};
  const cardId = text(p.cardId);
  const message = text(p.text)?.trim();
  return cardId && message ? { cardId, text: message } : null;
}

// An answer as a Mac reads it off the network: the card, the request, the allow/deny, the answers, and the
// question reply. Returns null when any required field is missing or the wrong type, or when the answer
// shape is invalid (only string values; the reply is sanitized the same way the permission route does it).
export function answerBody(command: Pick<CloudCommandRow, "payload">): AnswerPayload | null {
  const raw: unknown = command.payload;
  const p: Partial<Record<keyof AnswerPayload, unknown>> = raw && typeof raw === "object" ? raw : {};
  const cardId = text(p.cardId);
  const pendingId = text(p.pendingId);
  if (!cardId || !pendingId) return null;
  const allow = p.allow === true;
  const answers =
    p.answers && typeof p.answers === "object" && !Array.isArray(p.answers)
      ? (Object.fromEntries(Object.entries(p.answers as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string>)
      : undefined;
  const reply = p.reply && typeof p.reply === "object" ? readQuestionReply(p.reply) : undefined;
  const out: AnswerPayload = { cardId, pendingId, allow };
  if (answers && Object.keys(answers).length) out.answers = answers;
  if (reply) out.reply = reply;
  const grant = allow ? GRANT_SCOPES.find((s) => s === p.grant) : undefined;
  if (grant) out.grant = grant;
  return out;
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

// A stop as a Mac reads it off the network: the card the turn runs on, or null when missing.
export function stopBody(command: Pick<CloudCommandRow, "payload">): StopPayload | null {
  const raw: unknown = command.payload;
  const p: Partial<Record<keyof StopPayload, unknown>> = raw && typeof raw === "object" ? raw : {};
  const cardId = text(p.cardId);
  return cardId ? { cardId } : null;
}

// A command's prompt for the strip and the reply box: a new card's prompt, a reply's text, an answer's
// "Allowed" / "Denied" / answers, or "Stop".
export const commandText = (command: Pick<CloudCommandRow, "payload" | "kind">): string => {
  const kind = command.kind as string;
  const p = command.payload as Partial<NewCardPayload & ReplyPayload & AnswerPayload & StopPayload>;
  if (p.text) return p.text;
  if (p.prompt) return p.prompt;
  if (kind === "stop") return "Stop";
  if (kind === "answer") {
    if (p.answers) {
      const joined = Object.values(p.answers).join("; ");
      if (joined) return joined;
    }
    return p.allow ? "Allowed" : "Denied";
  }
  return "";
};
