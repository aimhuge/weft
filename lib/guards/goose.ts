import fs from "node:fs";
import path from "node:path";
import { gooseStateRoot } from "../goose-state";
import type { Session } from "../runner-state";
import { hookCommand } from "./answer";
import type { GuardEvent } from "./decide";
import { GuardsUnavailable, openGuards } from "./turn";

// Weft's guards on a Goose turn (docs/architecture/thread-guards.md). Goose 1.56 loads open-plugins from its state
// root's .agents/plugins, and a plugin's hooks/hooks.json can block any tool call before it runs ({"decision":
// "block"}), in every GOOSE_MODE: its shell, write, edit and tree tools and every extension's. Each card has its own
// root (lib/goose-state.ts), so Weft writes its plugin there for the turn and nothing touches ~/.config/goose.
//
// The hook carries the turn's route and token in the file (mode 0600) rather than in Goose's env, which its shell
// would show the model. Goose gives up on a hook after 30 seconds by default and lets the call through, so each
// hook gets an hour, and the route refuses an unanswered ask before that (lib/guards/hook.ts).
const PLUGIN = "weft-guards";
const EVENTS: GuardEvent[] = ["PreToolUse", "PostToolUse", "PostToolUseFailure"];
const HOOK_TIMEOUT = 3600;

/** The card's Weft guards plugin, in its Goose state root. */
export function gooseGuardsDir(cardId: string): string {
  return path.join(gooseStateRoot(cardId), ".agents", "plugins", PLUGIN);
}

/** The plugin's hooks.json: every tool, every event, through Weft's guard route. */
export function gooseHooksJson(where: { url: string; token: string }): string {
  const hooks = Object.fromEntries(
    EVENTS.map((event) => [event, [{ matcher: ".*", hooks: [{ type: "command", timeout: HOOK_TIMEOUT, command: hookCommand("goose", event, where) }] }]]),
  );
  return `${JSON.stringify({ hooks }, null, 2)}\n`;
}

/**
 * Opens the session's guards for its next Goose turn and writes the plugin that sends Goose's calls to them. Returns
 * what closes them again. Throws GuardsUnavailable when either can't be done: Goose doesn't start without them.
 */
export function openGooseGuards(session: Session): () => void {
  const guards = openGuards(session, "goose");
  const dir = gooseGuardsDir(session.cardId as string);
  try {
    fs.mkdirSync(path.join(dir, ".plugin"), { recursive: true });
    fs.mkdirSync(path.join(dir, "hooks"), { recursive: true });
    const manifest = { name: PLUGIN, version: "1.0.0", description: "Weft's guards: every tool call is checked by Weft before it runs." };
    fs.writeFileSync(path.join(dir, ".plugin", "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, "hooks", "hooks.json"), gooseHooksJson(guards), { mode: 0o600 });
  } catch (err) {
    guards.close();
    throw new GuardsUnavailable(`the Goose plugin couldn't be written: ${err instanceof Error ? err.message : String(err)}`);
  }
  return () => {
    guards.close();
    fs.rmSync(path.join(dir, "hooks", "hooks.json"), { force: true });
  };
}
