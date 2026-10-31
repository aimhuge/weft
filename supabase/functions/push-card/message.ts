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
    toolName?: string;
    title?: string;
    questions?: { question?: string }[];
    elicitation?: unknown;
  } | null;
}

// https://docs.expo.dev/push-notifications/sending-notifications/#message-request-format
export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: { cardId: string; org: string; orgId: string; column: PushColumn };
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

// The line under the title: the question the thread asked, the tool it wants to run, or what it's waiting on.
export function pushBody(card: PushCard, column: PushColumn): string {
  if (column === "review") return "Ready for review";
  const pending = card.pending;
  const question = pending?.questions?.find((q) => q.question?.trim())?.question;
  if (question) return clip(question, MAX_BODY);
  if (pending?.elicitation) return clip(pending.title || "Asks you to choose", MAX_BODY);
  if (pending) return clip(`Wants to run ${pending.title || pending.toolName || "a tool"}`, MAX_BODY);
  return clip(card.remaining || card.lastLine || "Needs you", MAX_BODY);
}

// A held tool or question can be answered from the notification (iOS category "needs_you"); a plain needs_you is
// the thread waiting on a reply in the thread, so it just opens the card.
export function isActionable(card: PushCard, column: PushColumn): boolean {
  return column === "needs_you" && !!card.pending;
}

export function buildMessages(card: PushCard, column: PushColumn, org: { id: string; slug: string }, tokens: string[]): ExpoMessage[] {
  const title = clip(card.title || "Weft", MAX_TITLE);
  const body = pushBody(card, column);
  const categoryId = isActionable(card, column) ? ("needs_you" as const) : undefined;
  return tokens.map((to) => ({
    to,
    title,
    body,
    data: { cardId: card.id, org: org.slug, orgId: org.id, column },
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
