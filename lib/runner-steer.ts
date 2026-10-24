// A message sent while a Claude Code or puku thread is mid-turn goes into its CLI at once, the way the CLI's own
// queue does: the CLI folds it into the running turn as the next tool call returns, so the agent reads it then
// instead of after the whole turn. Codex and Goose (one CLI process per turn) and the copilot keep the "after this
// turn" hold (lib/runner.ts holdForTurn). docs/architecture/threads-and-sessions.md#mid-turn-messages
import { randomUUID } from "node:crypto";
import type { Session } from "./runner-state";
import { appendThread } from "./store";

export function canSteer(session: Session | undefined): session is Session {
  if (!session?.busy || session.stopping || session.spec.copilot) return false;
  return session.spec.backend === "claude" || session.spec.backend === "puku";
}

// The thread shows it where you sent it, marked mid-turn. It has no prompt id: the CLI folds it into the turn
// that's running rather than starting one, so ↑ has no turn of its own to rewind and sends an edit as a copy.
// cli is what the CLI gets: the text, with what your "!" commands printed since your last message (lib/shell.ts).
export function steer(cardId: string, session: Session, text: string, cli = text) {
  const uuid = randomUUID();
  session.inbox.push(cli, uuid);
  (session.steered ??= new Set()).add(uuid);
  appendThread(cardId, { kind: "user", text, at: Date.now(), midTurn: true });
}

// At a turn's result: whether a message sent mid-turn is still waiting in the CLI, because the turn ended without
// another tool call to fold it in after. The CLI then runs it as a turn of its own, straight after this result.
// The result lists the messages the turn took in (user_message_uuids); puku's doesn't, so its follow-on turn is
// picked up as its first reply arrives instead (lib/runner-turn.ts handleAssistant).
export function waitingInCli(session: Session, took: string[] | undefined): boolean {
  const steered = session.steered;
  if (!steered?.size) return false;
  if (!took) {
    steered.clear();
    return false;
  }
  for (const id of took) steered.delete(id);
  return steered.size > 0;
}
