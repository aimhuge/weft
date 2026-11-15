// What a phone push says for a card, and which tokens Expo says are dead (docs/architecture/mobile.md#push).
// Pure, with no Deno or npm imports, so the push-card Edge Function (./index.ts) and Vitest share it.

export type PushColumn = "needs_you" | "review";

// The bits of a cloud_cards row's `card` (lib/types-card-detail.ts Card) a push reads.
export interface PushCard {
  id: string;
  title?: string;
  remaining?: string;
  lastLine?: string;
  pending?: {
    id?: string;
    toolName?: string;
    title?: string;
    input?: Record<string, unknown>;
    questions?: { question?: string }[];
    elicitation?: unknown;
  } | null;
}

// What the held prompt is: a tool waiting on Allow / Deny, questions the thread asked, or an MCP server's form.
export type PendingKind = "permission" | "question" | "form";

export interface PushData {
  cardId: string;
  org: string;
  orgId: string;
  column: PushColumn;
  // card.pending.id and its kind, so the phone's Allow / Deny answers the very prompt it was shown.
  pendingId?: string;
  kind?: PendingKind;
}

// https://docs.expo.dev/push-notifications/sending-notifications/#message-request-format
export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: PushData;
  sound: "default";
  priority: "high";
  categoryId?: "needs_you";
}

export type ExpoTicket = { status: "ok"; id: string } | { status: "error"; message?: string; details?: { error?: string } };

// Expo takes up to 100 messages a request.
export const EXPO_BATCH = 100;

const MAX_TITLE = 80;
const MAX_BODY = 178;

export function isPushColumn(value: unknown): value is PushColumn {
  return value === "needs_you" || value === "review";
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// Values a notification must never show: the lock screen is public. Order matters: whole headers and assignments
// first, then bare tokens left anywhere else.
const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(authorization|x-api-key|api-key|cookie)(\s*:\s*)[^"'\n]*/gi, "$1$2•••"],
  [/\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 •••"],
  [/\b([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s"';&|]+)/g, "$1=•••"],
  [/\b(sk|pk|rk)[-_](live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{12,}/g, "•••"],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, "•••"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]+)?/g, "•••"],
  [/\b(?=[A-Fa-f0-9]*\d)(?=[A-Fa-f0-9]*[A-Fa-f])[A-Fa-f0-9]{32,}\b/g, "•••"],
  // A long run of mixed case and digits with no slash or dot is a key, not a path or a word.
  [/(?<![A-Za-z0-9+_-])(?=[A-Za-z0-9+_-]*\d)(?=[A-Za-z0-9+_-]*[a-z])(?=[A-Za-z0-9+_-]*[A-Z])[A-Za-z0-9+_-]{32,}={0,2}/g, "•••"],
];

export function scrubSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((out, [re, sub]) => out.replace(re, sub), text);
}

export function pendingKind(pending: PushCard["pending"]): PendingKind | undefined {
  if (!pending) return undefined;
  if (pending.questions?.some((q) => q.question?.trim())) return "question";
  if (pending.elicitation) return "form";
  return "permission";
}

const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

// mcp__supabase__apply_migration → "supabase apply_migration"
function toolLabel(toolName: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(toolName);
  return mcp ? `${mcp[1]} ${mcp[2]}` : toolName;
}

// The key input a person decides a held tool on: the command, the file, the url, or an MCP call's first string.
function keyInput(toolName: string, input: Record<string, unknown>): string | undefined {
  if (toolName === "Bash") return str(input.command);
  if (["Write", "Edit", "MultiEdit", "Read", "NotebookEdit"].includes(toolName)) return str(input.file_path) ?? str(input.notebook_path);
  if (toolName === "WebFetch") return str(input.url);
  if (toolName.startsWith("mcp__")) return Object.values(input).map(str).find(Boolean);
  return undefined;
}

// "Bash: pnpm test", "Write: lib/x.ts", "supabase apply_migration: push_devices"; the prompt's title when the tool
// has no key input it knows.
export function permissionBody(pending: NonNullable<PushCard["pending"]>): string {
  const tool = pending.toolName || "";
  const what = tool ? keyInput(tool, pending.input ?? {}) : undefined;
  if (tool && what) return `${toolLabel(tool)}: ${what}`;
  if (tool && pending.title && pending.title !== tool) return `${toolLabel(tool)}: ${pending.title}`;
  return `Wants to run ${tool ? toolLabel(tool) : pending.title || "a tool"}`;
}

// The line under the title: the question the thread asked, the tool call it holds, or what it's waiting on.
export function pushBody(card: PushCard, column: PushColumn): string {
  if (column === "review") return "Ready for review";
  const pending = card.pending;
  const question = pending?.questions?.find((q) => q.question?.trim())?.question;
  const text = !pending
    ? card.remaining || card.lastLine || "Needs you"
    : question || (pending.elicitation ? pending.title || "Asks you to choose" : permissionBody(pending));
  return clip(scrubSecrets(text), MAX_BODY);
}

// Only a held tool can be answered from the notification (iOS category "needs_you": Allow / Deny). Questions and
// forms open the card; so does a plain needs_you, the thread waiting on a reply in the thread.
export function isActionable(card: PushCard, column: PushColumn): boolean {
  return column === "needs_you" && pendingKind(card.pending) === "permission";
}

export function pushData(card: PushCard, column: PushColumn, org: { id: string; slug: string }): PushData {
  const data: PushData = { cardId: card.id, org: org.slug, orgId: org.id, column };
  const kind = column === "needs_you" ? pendingKind(card.pending) : undefined;
  if (!kind) return data;
  return { ...data, kind, ...(card.pending?.id ? { pendingId: card.pending.id } : {}) };
}

export function buildMessages(card: PushCard, column: PushColumn, org: { id: string; slug: string }, tokens: string[]): ExpoMessage[] {
  const title = clip(card.title || "Weft", MAX_TITLE);
  const body = pushBody(card, column);
  const data = pushData(card, column, org);
  const categoryId = isActionable(card, column) ? ("needs_you" as const) : undefined;
  return tokens.map((to) => ({
    to,
    title,
    body,
    data,
    sound: "default",
    priority: "high",
    ...(categoryId ? { categoryId } : {}),
  }));
}

export function batches<T>(items: T[], size = EXPO_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Expo answers with one ticket per message, in order; a DeviceNotRegistered ticket means the app was uninstalled
// or the token rotated, so the row goes.
export function deadTokens(messages: ExpoMessage[], tickets: ExpoTicket[]): string[] {
  return messages.filter((_, i) => {
    const t = tickets[i];
    return t?.status === "error" && t.details?.error === "DeviceNotRegistered";
  }).map((m) => m.to);
}
