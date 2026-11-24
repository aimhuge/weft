import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Session } from "./runner-state";

// The one shape every CLI outside the Agent SDK runs in (docs/architecture/cli-adapters.md). Claude Code and puku-cli
// go through the SDK's query(); every other CLI is an adapter, and driveAdapter() is the turn loop they share: it takes
// the session's messages one at a time, hands each to the adapter, and closes the adapter when the inbox ends.
//
// Two kinds fit it. A CLI that runs one process per turn (Codex, Goose) only implements runTurn. A CLI that stays warm
// between turns (Antigravity, over ACP) also implements start, to open its process once, cancel, to stop a turn while
// keeping the process, and close.
export interface CliAdapter<State = void> {
  /** The CLI's name, for errors the user reads. */
  name: string;
  /** Opens what lives across turns (a warm process); runs before the first turn. */
  start?(session: Session): Promise<State>;
  /** Runs one turn: the thread rows go in through lib/cli-messages.ts, and the turn ends with a result row. */
  runTurn(session: Session, message: SDKUserMessage, state: State): Promise<void>;
  /** Stops the running turn but keeps what start opened. Without it, a stop ends the process. */
  cancel?(session: Session, state: State): void;
  /** Closes what start opened, once the inbox ends or the session is aborted. */
  close?(session: Session, state: State): Promise<void> | void;
}

// The running adapter's cancel, per session, for lib/runner.ts's stop.
const cancels = new WeakMap<Session, () => void>();

/** Stops the session's running turn through its adapter. False when its adapter can't, and the process must end. */
export function cancelTurn(session: Session): boolean {
  const cancel = cancels.get(session);
  if (!cancel) return false;
  cancel();
  return true;
}

/** Runs the session's turns on an adapter until its inbox closes or the session is aborted. */
export async function driveAdapter<State>(session: Session, adapter: CliAdapter<State>): Promise<void> {
  const state = (adapter.start ? await adapter.start(session) : undefined) as State;
  if (adapter.cancel) cancels.set(session, () => adapter.cancel?.(session, state));
  try {
    for await (const message of session.inbox) {
      if (session.abort.signal.aborted) break;
      session.toolIndex.clear();
      await adapter.runTurn(session, message, state);
    }
  } finally {
    cancels.delete(session);
    await adapter.close?.(session, state);
  }
}

/** The text of the message a turn starts with: a string, or the text parts of a content list. */
export function messageText(message: { message?: { content?: unknown } }): string {
  const content = message.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object" || !("text" in part)) return "";
      // A part that isn't a string must not stringify to "[object Object]": only primitives are kept.
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") return text;
      if (typeof text === "number" || typeof text === "boolean") return String(text);
      return "";
    })
    .join("\n");
}

export const CLI_ADAPTER_CODE = [driveAdapter, cancelTurn, messageText];
