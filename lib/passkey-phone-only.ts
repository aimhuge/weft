// Which asks a browser's passkey may not approve (docs/architecture/mobile-security.md, "Passkey approvals"): the
// riskiest stay on the phone or the Mac, where the OS prompt is native and no script on a web page can change what it
// shows. Best-effort by nature, since a shell can spell anything many ways; the main defence is that the approval sheet
// shows the whole input it signs. Matched on a normalized copy of the input: shell quotes, backslashes and $'' escapes
// stripped, whitespace collapsed, lowercased.
import type { PasskeyAction } from "./approval-passkey";
import type { PendingPermission } from "./types";

export const PHONE_ONLY =
  "That one needs your phone or this Mac: a vault secret, skipping permissions or changing an agent's settings can't be approved from a browser.";

// Turning permissions, approvals or the sandbox off: Claude Code, Codex and Goose flags, modes and settings.
const SKIPS = [
  /bypasspermissions/,
  /dangerously-skip-permissions/,
  /allow-dangerously-skip/,
  /--yolo(?![\w-])/,
  /dangerously-bypass-approvals-and-sandbox/,
  /danger-full-access/,
  /(^|\s)(-a|--ask-for-approval)[\s=]*never/,
  /approval[_-]policy\s*=\s*never/,
  /--full-auto/,
  /--allowed-?tools[\s=]*\S*\*/,
  /goose_mode\s*=\s*auto/,
];

// Writing an agent's own config or hooks: whatever reads it next runs with what it says. A config folder counts as a
// path segment or a cd target, with or without a slash after it.
const CONFIG = [/(^|[\s/=:(~;&|])\.(claude|codex|goose)(?!\w)/, /settings\.local\.json/, /(^|[\s/=:(~;&|])\.mcp\.json/, /\.git\/hooks\//, /hookspath/, /\.githooks\//];
const SETTINGS = /settings[\w.-]*\.json/;
const PERMISSION_KEYS = /permissions|defaultmode/;
// A path built from a variable or a command near an agent's name: what it expands to can't be read here, so refuse.
const BUILT = /\$[\w{(][^]{0,40}?(claude|codex|goose)|(claude|codex|goose)[^]{0,40}?\$[\w{(]/;

export function normalizeForRisk(text: string): string {
  return text
    .replace(/\$'/g, "")
    .replace(/\\[ntr]/g, " ")
    .replace(/\\(.)/g, "$1")
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function phoneOnly(action: PasskeyAction): boolean {
  if (action.toolName.startsWith("mcp__secrets__")) return true;
  // The JSON's own escapes go first, so a command's \n reads as a space and its \" as a quote.
  const text = normalizeForRisk(Object.values(action.input).map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(" "));
  if (SKIPS.some((r) => r.test(text)) || CONFIG.some((r) => r.test(text)) || BUILT.test(text)) return true;
  return SETTINGS.test(text) && PERMISSION_KEYS.test(text);
}

// Whether this answer is an Allow on a phone-only permission request (not a question or a form): on this Mac's own card
// it then needs main's signature after Touch ID (lib/local-approve.ts, lib/answer-signer.ts localSignedAnswer).
export function phoneOnlyAllow(pending: Pick<PendingPermission, "toolName" | "input" | "questions" | "elicitation"> | null | undefined, allow: boolean): boolean {
  if (!pending || !allow || pending.questions?.length || pending.elicitation) return false;
  // A request read off the wire may lack its fields; one with no tool names nothing to run.
  const { toolName, input } = pending as Partial<PendingPermission>;
  return typeof toolName === "string" && phoneOnly({ toolName, input: input && typeof input === "object" ? input : {} });
}
