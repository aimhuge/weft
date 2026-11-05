// Output cleanup for the login pop-up: terminal control codes, login URL detection, and the
// "the CLI's last turn had an auth error" regex. Pure functions used by lib/login.ts.

const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const OTHER_ESCAPE = /\x1b[ -/]*[0-~]?/g;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const OSC8_URL = /\x1b\]8;[^;\x07\x1b]*;(https:\/\/[^\x07\x1b\s]+)/g;
const PLAIN_URL = /https:\/\/[^\s"'<>`]+/g;

// Strip terminal control codes and collapse redundant whitespace; raw lets escape codes split
// across chunks still strip cleanly when more output piles on.
export function clean(raw: string) {
  return raw
    .replace(OSC, "")
    .replace(CSI, "")
    .replace(OTHER_ESCAPE, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(CONTROL, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

// A terminal hyperlink's target if the CLI printed one (it survives line wrapping), otherwise
// the last plain https URL in the output. Trailing punctuation gets stripped.
export function lastUrl(raw: string, text: string) {
  const linked = [...raw.matchAll(OSC8_URL)].map((m) => m[1]);
  const plain = text.match(PLAIN_URL) ?? [];
  const url = linked.at(-1) ?? plain.at(-1);
  return url?.replace(/[)\].,;:!?'"]+$/, "");
}

export function errMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

// Ink-based logins can refuse to start without a terminal. The patterns are CLI-vendor-specific
// and best tested as a single regex here.
export function needsTty(text: string) {
  return /raw mode is not supported|not a tty|isn't a tty|setRawMode|inappropriate ioctl|stdin is not a terminal|ERR_TTY/i.test(text);
}

// Spots a "you need to log in" error in the CLI's output so the board can pop the login dialog.
export function isNotLoggedInError(text: string): boolean {
  return /not logged in|not authenticated|please run (?:\/login|codex login)|invalid api key|oauth (?:token|session) (?:has )?expired|failed to authenticate|authentication_error/i.test(text);
}

// Distinct from a transient error or a not-logged-in: when the CLI's last turn hit the
// plan's rate limit, the card menu offers a one-click switch to the other backend.
export function isRateLimitError(text: string): boolean {
  return /rate.?limit|hit your limit|usage limit|limit reached|limit exceeded/i.test(text);
}
