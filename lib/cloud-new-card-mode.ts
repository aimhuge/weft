// The mode a new card from the web starts in on a Mac (lib/cloud-inbox-cards.ts). A row off the network is held to the
// rule a mode change is (lib/host/dispatch.ts): never bypassPermissions (@weft/client remoteRefusal), and a mode that
// asks less than the default only while the web may approve (no phone paired, or Settings → Sync says so). That goes for
// the mode the Mac would pick by itself too: a form that names none gets this Mac's default, which is `auto` out of the
// box and may be bypassPermissions, and leaving the field out mustn't buy what naming it can't. A Mac has no plan mode
// (MODES), and the card maker reads a mode it doesn't know as the default, so plan starts in `default` here, never in
// whatever the default happens to be.
import type { NewCardMode } from "./cloud-commands";
import type { PermissionMode } from "./types";

export interface StartModeDeps {
  // This Mac's default for a new thread (lib/settings.ts defaultPermissionMode).
  defaultMode: () => PermissionMode;
  // Why a looser mode can't be set from the web right now, or null when it can (the Mac's CardRules.elevated).
  refusal: (mode: PermissionMode) => Promise<string | null>;
}

// The mode to start in. A looser mode the row named and the web may not set is refused (the form says why); one the row
// left to the Mac's default falls back to `default`, which asks, so a plain new thread still starts.
export async function networkStartMode(named: NewCardMode | PermissionMode | undefined, { defaultMode, refusal }: StartModeDeps): Promise<PermissionMode> {
  const asked = named === "plan" ? "default" : named;
  const mode = asked ?? defaultMode();
  if (mode === "default") return mode;
  if (mode === "bypassPermissions") {
    if (asked) throw new Error("A request from the web can't skip permission prompts. Pick that mode on the Mac.");
    return "default";
  }
  const refused = await refusal(mode);
  if (!refused) return mode;
  if (asked) throw new Error(refused);
  return "default";
}
