import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { takeGrant } from "../classifier-denial";
import { claimQuestion, claimSymbols, claimWhy } from "../claim-guard";
import { folderAsk, grantedRead } from "../folder-guard";
import { askUser } from "../runner-ask";
import type { Session } from "../runner-state";

// What happens when a guard (or the card's permission mode) asks about a call: the card asks you, in the guard's own
// words, and the call waits for your answer. Claude Code and puku-cli reach this from the SDK's canUseTool
// (lib/runner-session.ts); Codex and Goose from Weft's guard route (lib/guards/hook.ts), whose hook holds the call
// until you answer. So an outside folder or another card's symbol asks the same on every CLI.
export function askAboutCall(
  session: Session,
  toolName: string,
  input: Record<string, unknown>,
  toolUseID: string,
  signal: AbortSignal,
  title?: string,
): Promise<PermissionResult> {
  if (!session.cardId) return Promise.resolve({ behavior: "deny", message: "No card is attached yet." });
  // A call auto mode blocked that you allowed once (lib/classifier-denial.ts), in case the retry asks instead.
  if (takeGrant(session, toolName, input)) return Promise.resolve({ behavior: "allow", updatedInput: input });
  // A folder the user granted (lib/folder-guard.ts) is read without the CLI's own working-directory prompt.
  if (grantedRead(toolName, input, session.spec.cwd, session.cardId)) return Promise.resolve({ behavior: "allow", updatedInput: input });
  // A folder outside the project (lib/folder-guard.ts) or a symbol-claim clash (lib/claim-guard.ts) asks in its own words.
  const folder = folderAsk(toolUseID);
  return askUser(session.cardId, session, toolName, input, signal, folder?.question ?? claimQuestion(toolUseID) ?? title, {
    symbols: claimSymbols(toolUseID),
    why: folder?.why ?? claimWhy(toolUseID),
    folder: folder?.folder,
  });
}
