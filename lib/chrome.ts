import { onWorker } from "./worker-pane";
import type { Backend } from "./types";

// The user's own Chrome, beside the pane (docs/architecture/agent-browser.md#the-users-chrome). Claude Code's
// --chrome flag connects the Claude in Chrome extension, so a thread gets mcp__claude-in-chrome__* and can act in
// the browser the user is signed in to everywhere. Only the Claude Code CLI has the flag (puku-cli, Codex and Goose
// don't), and only on the desktop: a Weft Worker has no Chrome of the user's.
type ChromeSpec = { backend: Backend; copilot?: boolean };

export function reachesChrome(spec: ChromeSpec, worker = onWorker()): boolean {
  return spec.backend === "claude" && !spec.copilot && !worker;
}

// The CLI flags for a session (Options.extraArgs: a null value is a bare flag).
export function chromeArgs(spec: ChromeSpec, worker = onWorker()): Record<string, null> | undefined {
  return reachesChrome(spec, worker) ? { chrome: null } : undefined;
}

export const CHROME_PROMPT = `You can also drive the user's own Chrome, the browser they use every day and are signed in to everywhere, with the mcp__claude-in-chrome__* tools (Claude in Chrome). Neither browser is out of reach, so never tell the user you can't use their browser.
- Use the pane by default: your own pages, dev servers, public sites, docs, and anything the user should watch beside the board.
- Use Chrome when the work needs a sign-in the pane doesn't have (a dashboard, an editor like Substack or Google Docs, an admin page, a paywalled site), when the user asks for "my browser" or "Chrome", or when they say a page is already open there. Try the pane first only when you don't know which browser holds the sign-in, and switch to Chrome as soon as the pane lands on a login page.
- In Chrome, call tabs_context_mcp first, then work in a tab of your own (tabs_create_mcp) unless the user points you at a tab they have open. Read with get_page_text, read_page or find; act with computer, form_input or navigate; run code in the page with javascript_tool. Don't close or navigate away from the user's own tabs.
- If the Chrome tools aren't listed or time out, the extension isn't connected: say so in one line (Chrome open, Claude extension signed in), then fall back to AppleScript from Bash, which reaches every Chrome tab: osascript -e 'tell application "Google Chrome" to execute active tab of front window javascript "document.title"'. Running JavaScript that way needs Chrome's View → Developer → Allow JavaScript from Apple Events; if it's off, ask the user to turn it on. Put longer scripts in a file and run osascript on it.
- Chrome is not on the pane, so the user can't see it from the board: when you've changed something there, take a screenshot (computer with action screenshot) or show the result on your page.`;
