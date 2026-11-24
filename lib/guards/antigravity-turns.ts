import { globalSingleton } from "../global-singleton";

// Which Antigravity conversation is which Weft turn's guards (lib/guards/antigravity.ts). agy's hooks get the
// conversation's id in their payload, and a hook that carried a token would need it in agy's env, where the model's
// shell would see it. So the runner registers each ACP session (its id is the conversation's) against its guard token,
// and the guard route finds the turn from the payload. On globalThis: the route loads its own copy of this module.
const tokens = globalSingleton("__weftAntigravityGuards", () => new Map<string, string>());

// What Weft's after-call guards had to say about a conversation's calls (a lint reminder, a refused write's reason),
// kept until agy's next model call: its PostToolUse hook can only answer {}, so the notes go in through PreInvocation's
// injectSteps instead (lib/guards/antigravity.ts). Kept per conversation, only while Weft's guards for it are open.
const notes = globalSingleton("__weftAntigravityNotes", () => new Map<string, string[]>());

/** Ties a conversation to its open guards. Returns what unties it, for when they close. */
export function bindConversation(conversationId: string, token: string): () => void {
  tokens.set(conversationId, token);
  return () => {
    if (tokens.get(conversationId) !== token) return;
    tokens.delete(conversationId);
    notes.delete(conversationId);
  };
}

/** The guard token of the conversation a hook payload comes from, or undefined for one Weft didn't start. */
export function antigravityToken(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const id = (payload as { conversationId?: unknown }).conversationId;
  return typeof id === "string" ? tokens.get(id) : undefined;
}

function conversationOf(payload: unknown): string | undefined {
  const id = payload && typeof payload === "object" ? (payload as { conversationId?: unknown }).conversationId : undefined;
  return typeof id === "string" && tokens.has(id) ? id : undefined;
}

/** Keeps a note for the model of the conversation a hook payload comes from. */
export function noteForModel(payload: unknown, text: string): void {
  const id = conversationOf(payload);
  if (!id || !text.trim()) return;
  notes.set(id, [...(notes.get(id) ?? []), text]);
}

/** The PreInvocation answer for a hook payload: its conversation's notes as system messages, once, or nothing. */
export function takeNotes(payload: unknown): Record<string, unknown> {
  const id = conversationOf(payload);
  const kept = id ? notes.get(id) : undefined;
  if (!id || !kept?.length) return {};
  notes.delete(id);
  // No metadata: agy 1.5.16 dropped a step that carried it (measured), though its docs show one.
  return { injectSteps: [{ systemMessage: { systemMessage: kept.join("\n\n") } }] };
}
