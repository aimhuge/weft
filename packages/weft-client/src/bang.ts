// "!" at the start of a reply: a shell command, as in Claude Code's bash mode (lib/shell.ts runs it).
// Kept apart from lib/shell.ts so the reply box can read it without the server's modules, and in @weft/client so a
// host command's check and the phone read it the same (lib/bang.ts re-exports it).

// Markdown escapes a leading "!" (it could start an image), so the reply box's draft may hold "\!".
// A pasted picture is "![name](path)", so a reply that starts with one is a message, not a command.
const BANG = /^\s*\\?!(?!\[)/;

export function isBang(text: string): boolean {
  return BANG.test(text);
}

// The command after the "!", or null when the text isn't one. A bare "!" is an empty command.
export function bangCommand(text: string): string | null {
  return isBang(text) ? text.replace(BANG, "").trim() : null;
}
