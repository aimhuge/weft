// Goose's `stream-json` output, parsed (docs/architecture/goose.md).
//
// `goose run --output-format stream-json` writes one JSON object per line on stdout. A line is one of
// four kinds: `message` (the assistant's text), `notification` (progress), `error` (the turn failed) and
// `complete` (the turn is over).
//
// The one subtlety: `NotificationData` has no tag of its own, so a notification can't be told apart from
// another payload by its fields alone. It is told apart by the `progress` key it always carries — a
// payload with a `progress` key is a notification, and one without isn't.
//
// Pure: no fs, no env, no I/O. Everything it needs is the line it is given.

/**
 * A message from Goose: the assistant's text. Goose 1.x streams one reply as many lines that share the
 * message's id, each with the next slice of its text, so id says which reply a slice belongs to.
 */
export interface GooseMessageEvent {
  kind: "message";
  text: string;
  id?: string;
}

/** A progress note from Goose: what it is doing, not what it said. */
export interface GooseNotificationEvent {
  kind: "notification";
  progress: string;
}

/** An error from Goose: the turn failed. */
export interface GooseErrorEvent {
  kind: "error";
  message: string;
}

/** The end of the turn. */
export interface GooseCompleteEvent {
  kind: "complete";
  text: string;
}

/** Anything Goose wrote that Weft doesn't act on. */
export interface GooseUnknownEvent {
  kind: "unknown";
  type: string;
}

/** One event from Goose's stream. */
export type GooseEvent = GooseMessageEvent | GooseNotificationEvent | GooseErrorEvent | GooseCompleteEvent | GooseUnknownEvent;

// The shape of a line as it arrives: the kind is spelled several ways across Goose's own versions, and
// the payload may sit under the line's own keys or nested under one of them.
interface RawLine {
  type?: unknown;
  kind?: unknown;
  event?: unknown;
  message?: unknown;
  text?: unknown;
  content?: unknown;
  progress?: unknown;
  error?: unknown;
  // Goose's older stream shapes nest the payload under `data`.
  data?: unknown;
}

/** A string, or "" for anything that isn't one. */
function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/** The nested payload of a line, when it has one. */
function nested(line: RawLine): RawLine | null {
  const data = line.data;
  return data && typeof data === "object" && !Array.isArray(data) ? data : null;
}

/** The kind a line names, whichever field spells it. */
function kindOf(line: RawLine): string {
  for (const candidate of [line.type, line.kind, line.event]) {
    const kind = str(candidate).trim().toLowerCase();
    if (kind) return kind;
  }
  return "";
}

/** A Goose 1.x message, `{ id, role, content: [{ type: "text", text }] }`, when the line carries one. */
interface GooseMessage {
  id?: unknown;
  role?: unknown;
  content?: unknown;
}

function messageObject(line: RawLine): GooseMessage | null {
  const message = line.message;
  return message && typeof message === "object" && !Array.isArray(message) ? message : null;
}

/** The text parts of a Goose 1.x message, joined. Its tool requests and other parts carry no text. */
function contentText(message: GooseMessage): string {
  if (!Array.isArray(message.content)) return str(message.content);
  return message.content
    .map((part: unknown) => (part && typeof part === "object" && (part as { type?: unknown }).type === "text" ? str((part as { text?: unknown }).text) : ""))
    .join("");
}

/**
 * The event a Goose 1.x message line is. The assistant's text is a message; a message from any other role
 * (Goose echoing a tool's response back as the user) is not the assistant speaking, so it is skipped.
 */
function messageEvent(message: GooseMessage): GooseEvent {
  if (str(message.role) !== "assistant") return { kind: "unknown", type: "message" };
  const text = contentText(message);
  if (!text) return { kind: "unknown", type: "message" };
  const id = str(message.id);
  return id ? { kind: "message", text, id } : { kind: "message", text };
}

/** The text of a message-ish payload: its own `message`, `text` or `content`. */
function textOf(line: RawLine): string {
  const direct = str(line.text) || str(line.message) || str(line.content);
  if (direct) return direct;
  const data = nested(line);
  if (!data) return "";
  return str(data.text) || str(data.message) || str(data.content);
}

/**
 * Whether a line is a notification. `NotificationData` has no tag of its own, so the `progress` key it
 * always carries is what tells it apart from a message.
 */
export function isGooseNotification(line: unknown): boolean {
  if (!line || typeof line !== "object") return false;
  const raw = line as RawLine;
  if (raw.progress !== undefined && raw.progress !== null) return true;
  const data = nested(raw);
  if (!data) return false;
  return data.progress !== undefined && data.progress !== null;
}

/** The progress a notification carries, wherever it sits. */
function progressOf(line: RawLine): string {
  const direct = str(line.progress);
  if (direct) return direct;
  return str(nested(line)?.progress);
}

/** An error line's message: its own `error`, or its text. */
function errorOf(line: RawLine): string {
  const message = str(line.error) || textOf(line);
  return message || "Goose reported an error.";
}

/** The kinds that end the turn, however Goose spells them. */
function isEndKind(kind: string): boolean {
  return kind === "complete" || kind === "completed" || kind === "end";
}

/** The kinds that carry the assistant's text. */
function isTextKind(kind: string): boolean {
  return kind === "message" || kind === "assistant" || kind === "text" || kind === "";
}

/**
 * One event from one line of Goose's stream, or null when the line isn't one: malformed JSON, a JSON
 * value that isn't an object, or a kind Weft doesn't act on.
 */
export function parseGooseEvent(line: string): GooseEvent | null {
  const text = line.trim();
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Goose prints the odd line of noise on stdout; skip it rather than fail the turn.
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed as RawLine;
  const kind = kindOf(raw);

  if (kind === "error") return { kind: "error", message: errorOf(raw) };
  if (isEndKind(kind)) return { kind: "complete", text: textOf(raw) };
  // A notification has no kind of its own, so it is recognised by the key it carries.
  if (isGooseNotification(raw)) return { kind: "notification", progress: progressOf(raw) };
  if (isTextKind(kind)) {
    const message = messageObject(raw);
    if (message) return messageEvent(message);
    const body = textOf(raw);
    if (body) return { kind: "message", text: body };
  }
  return { kind: "unknown", type: kind };
}

/** Whether an event ends the turn. */
export function endsGooseTurn(event: GooseEvent | null): boolean {
  return event?.kind === "complete";
}
