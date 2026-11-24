import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "../runner-state";
import { cliAnswer, UNANSWERED } from "./answer";
import { bindConversation } from "./antigravity-turns";
import { GUARD_URL_ENV, GuardsUnavailable, openGuards } from "./turn";

// Weft's guards on an Antigravity thread (docs/architecture/thread-guards.md, docs/architecture/antigravity.md).
// agy 1.5.16 runs every PreToolUse hook in ~/.gemini/config/hooks.json before a tool call, its reads included, and a
// {"decision": "deny"} fails the call with the reason the model then reads. agy has no flag or env var for another
// config folder, so Weft keeps one entry of its own in that shared file, "weft-guards", and leaves the rest alone.
//
// The entry is inert outside Weft: it acts only when agy's env has WEFT_GUARD_URL, which only a Weft thread's agy gets,
// and otherwise lets the call through, so your own agy sessions are untouched. It carries no token either: the route
// finds the turn from the payload's conversationId (lib/guards/antigravity-turns.ts), so nothing secret sits in agy's
// env for the model's shell to print. When Weft is asked and doesn't answer, the call is refused, as on Codex and Goose.
export const HOOK_NAME = "weft-guards";

// An ask can wait on you (lib/guards/ask.ts); the route refuses an unanswered one a minute before this.
const HOOK_TIMEOUT = 3600;

/** The folder agy reads its global hooks.json from. */
export function agyConfigDir(home = os.homedir()): string {
  return path.join(home, ".gemini", "config");
}

// The hooks Weft keeps: before a call (the guards' verdict), after one (the guards' notes on it, kept for the model),
// and before each model call (those notes, injected as system messages: agy's PostToolUse can only answer {}).
export const AGY_HOOK_EVENTS = ["PreToolUse", "PostToolUse", "PreInvocation"] as const;
export type AgyHookEvent = (typeof AGY_HOOK_EVENTS)[number];

/**
 * A hook's command: through Weft's guard route in a Weft thread, straight through anywhere else. When Weft doesn't
 * answer, a call is refused before it runs; after one, and before a model call, nothing changes.
 */
export function agyHookCommand(event: AgyHookEvent = "PreToolUse"): string {
  const pre = event === "PreToolUse";
  const allow = pre ? JSON.stringify(cliAnswer("antigravity", "PreToolUse", { allow: true })) : "{}";
  const refuse = pre ? JSON.stringify(cliAnswer("antigravity", "PreToolUse", { allow: false, reason: UNANSWERED })) : "{}";
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const post = `curl -sS --fail --max-time ${HOOK_TIMEOUT} -H "Content-Type: application/json" --data-binary @- "$${GUARD_URL_ENV}/antigravity/${event}" 2>/dev/null`;
  return `if [ -z "$${GUARD_URL_ENV}" ]; then cat >/dev/null; printf '%s\\n' ${quote(allow)}; exit 0; fi; out=$(${post}); if [ -n "$out" ]; then printf '%s\\n' "$out"; else printf '%s\\n' ${quote(refuse)}; fi`;
}

/** Weft's entry in hooks.json. */
export function weftHookEntry(): Record<string, unknown> {
  const handler = (event: AgyHookEvent) => ({ type: "command", command: agyHookCommand(event), timeout: HOOK_TIMEOUT });
  return {
    PreToolUse: [{ matcher: "*", hooks: [handler("PreToolUse")] }],
    PostToolUse: [{ matcher: "*", hooks: [handler("PostToolUse")] }],
    // Not a tool event, so agy takes its handlers straight under the event, with no matcher.
    PreInvocation: [handler("PreInvocation")],
  };
}

/**
 * hooks.json with Weft's entry in it, and every other entry as it was. Throws on a file that isn't a JSON object:
 * that's yours, half-edited perhaps, and Weft won't overwrite it.
 */
export function withWeftHook(existing: string | undefined): string {
  let hooks: Record<string, unknown> = {};
  if (existing?.trim()) {
    const parsed: unknown = JSON.parse(existing);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("hooks.json isn't a JSON object");
    hooks = parsed as Record<string, unknown>;
  }
  return `${JSON.stringify({ ...hooks, [HOOK_NAME]: weftHookEntry() }, null, 2)}\n`;
}

/** Puts Weft's entry in agy's hooks.json, written only when it changed, and atomically (a temp file then a rename). */
export function installAgyHook(dir = agyConfigDir()): void {
  const file = path.join(dir, "hooks.json");
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
  const next = withWeftHook(existing);
  if (next === existing) return;
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${file}.weft-${process.pid}`;
  fs.writeFileSync(temp, next);
  fs.renameSync(temp, file);
}

export type AgyGuards = { env: Record<string, string>; bind: (conversationId: string) => void; close: () => void };

/**
 * Opens the session's guards for its Antigravity process: the hook in hooks.json, the route's address for agy's env,
 * and `bind`, which ties the ACP session to them once it has an id. Throws GuardsUnavailable when either can't be
 * done: agy doesn't start without them.
 */
export function openAgyGuards(session: Session, dir = agyConfigDir()): AgyGuards {
  const guards = openGuards(session, "antigravity");
  try {
    installAgyHook(dir);
  } catch (err) {
    guards.close();
    throw new GuardsUnavailable(`Weft's hook couldn't be added to ${path.join(dir, "hooks.json")}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const unbinds: (() => void)[] = [];
  return {
    env: { [GUARD_URL_ENV]: guards.url },
    bind: (conversationId) => void unbinds.push(bindConversation(conversationId, guards.token)),
    close: () => {
      for (const unbind of unbinds) unbind();
      guards.close();
    },
  };
}
