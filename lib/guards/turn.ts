import { randomBytes } from "node:crypto";
import { globalSingleton } from "../global-singleton";
import { sessions, type Session } from "../runner-state";
import { guardHooks, type GuardHooks } from "./hooks";

// One Codex or Goose turn's guards, open while the turn runs. Its CLI's hook posts each tool call to Weft's guard
// route with the turn's token (lib/guards/hook.ts), which finds the turn's session and guard set here. Like the
// MCP bridge's token (lib/mcp-bridge.ts), it stands for one turn of one card and dies with the turn; it travels in
// the CLI's environment, which Weft keeps out of the model's shell (lib/guards/codex.ts, lib/guards/goose.ts).
export type GuardCli = "codex" | "goose";
export type GuardTurn = { cli: GuardCli; session: Session; hooks: GuardHooks };

export const GUARD_TOKEN_ENV = "WEFT_GUARD_TOKEN";
export const GUARD_URL_ENV = "WEFT_GUARD_URL";

// On globalThis: the route loads its own copy of these modules, while the runner that opens a turn lives in another.
const turns = globalSingleton("__weftGuardTurns", () => new Map<string, GuardTurn>());

/** Why a turn's guards couldn't be opened, said on the card: the turn doesn't start without them. */
export class GuardsUnavailable extends Error {
  constructor(why: string) {
    super(`Weft didn't start this turn: its guards couldn't be installed (${why}). Every CLI runs behind them, so nothing ran.`);
    this.name = "GuardsUnavailable";
  }
}

export type OpenGuards = { token: string; url: string; env: Record<string, string>; close: () => void };

/**
 * Opens the session's guards for one turn: a token, the env that carries it and the route's address, and what
 * closes them once the turn is over. Throws GuardsUnavailable outside the server (no PORT) or for a session with no
 * card, since nothing could answer the CLI's hook, and a CLI whose hook can't be answered must not run.
 */
export function openGuards(session: Session, cli: GuardCli, port = process.env.PORT): OpenGuards {
  if (!port) throw new GuardsUnavailable("Weft's server port isn't known");
  if (!session.cardId) throw new GuardsUnavailable("the thread has no card yet");
  const otherTurns = () => [...sessions.values()].filter((s) => s.busy && s !== session).length;
  const token = randomBytes(24).toString("base64url");
  turns.set(token, { cli, session, hooks: guardHooks(otherTurns, () => session.cardId ?? undefined) });
  const url = `http://127.0.0.1:${port}/api/guards`;
  return {
    token,
    url,
    env: { [GUARD_TOKEN_ENV]: token, [GUARD_URL_ENV]: url },
    close: () => void turns.delete(token),
  };
}

/** The open turn a token stands for, for the CLI it was opened for; undefined otherwise. */
export function guardTurn(token: string | undefined, cli: GuardCli): GuardTurn | undefined {
  const turn = token ? turns.get(token) : undefined;
  return turn?.cli === cli ? turn : undefined;
}
