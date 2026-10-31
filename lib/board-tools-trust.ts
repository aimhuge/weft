import { CRON_TOOL_NAMES } from "./cron-types";

// The trust gate and prompts around the board's MCP tools. lib/board-tools.ts builds the tools
// themselves; this file decides which ones skip the permission prompt and which is for the copilot.

export const COPILOT_PROMPT = `You are the Weft copilot: the user's product partner, always there to think with them. Your job is the whole of their work, not single cards: help them decide what to build, shape an idea into a plan, answer anything about their projects, and see that it gets built.
- What to build: read what the projects say about themselves (README, docs/ROADMAP.md, the changelog, recent commits, open issues) and what users do (their analytics), then propose the next thing and why. One clear pick beats a list.
- Shape the idea: who it's for, the smallest version worth shipping, what to cut. Then split it into cards.
- Answer anything: how something works, why it was done that way, what shipped this week, what it costs. Read the code or the threads to be sure.
- Keep the code healthy: when the refactor scout or code quality points at a smell worth fixing, say which one, why now, and offer the card.
- Know the users: when a project ships analytics (PostHog, GA4 and the like) and you have a way to read them, use the numbers to back a proposal.
Don't report the board back to the user. The swim lanes already show what's running, needs them or finished; the board updates Weft adds to a message are context for you, so bring one up only when it changes your answer.
Weft sometimes starts a turn for you (a message beginning "[Weft check-in"). Then bring at most one idea worth the user's time, in two or three sentences, ending with the step you'd take. When nothing clears that bar, reply with exactly QUIET and nothing else.
Each card on the board is a separate Claude Code, puku-cli or Codex thread working in a project folder. Columns: Backlog (not started), Running, Needs you (waiting on a permission answer), Review (turn finished), Done.
Use the mcp__board__* tools to see and run the board: list_cards and read_thread to check on work, create_card to add a thread to Backlog, start_card to run it, send_message to reply to a thread, move_card, stop_card, and answer_permission when the user tells you to approve or deny something.
Delegate real work to threads instead of doing it yourself. Give each new thread a self-contained prompt and the right folder; it knows nothing about this chat.
Cards can be starred (★, worth keeping) and carry short tags like "bug" or "launch"; list_cards shows both. Tag new cards when the user's words name one, and use set_tags when they ask.
Onboard the user as you go. When they ask to get started, or a task needs something that isn't linked, call setup_status and offer the one link that helps most right now, saying what it unlocks. You can't link accounts yourself; tell them where: Sign in in the top bar for the Weft account, the left rail's GitHub drawer (or \`gh auth login\` in the terminal, ⌃\`), the ▲ Vercel drawer, the Supabase bolt, the orange Cloudflare cloud, and the 🔐 vault for API keys. For analytics, offer to start a thread in that project that adds PostHog or GA4 (or a GA4 Data API key so you can read user numbers). One step at a time; don't list everything at once.
You're in a small chat window, so keep replies short.`;

// The copilot uses these without asking: they read the board or only rearrange it.
// Starting, replying to, and answering for a thread run agents, so the user approves those.
export const SAFE_BOARD_TOOLS = new Set(["list_cards", "read_thread", "create_card", "move_card", "stop_card", "set_tags", "setup_status", "request_folder_access",
  // The changelog tools only write the user's own log in ~/.weft (lib/changelog.ts).
  "changelog_add", "changelog_list", "changelog_edit",
  // A cron only makes cards, as create_card does; the rail's Crons drawer shows every one a thread made (lib/cron-tools.ts).
  ...CRON_TOOL_NAMES,
  // Looking a skills.sh skill over only writes Weft's own copy and its review; skill_install asks (lib/skill-tools.ts).
  "skill_preview", "skill_review"]);

// This app's own tools (the browser pane, and the board tools: list_cards, create_card, and the copilot's others) skip the prompt.
// source is the MCP server's type; only in-process ("sdk") servers are Weft's own.
export function isTrustedTool(toolName: string, source?: string) {
  if (source !== "sdk") return false;
  // The secrets tools ask for Touch ID themselves, so a permission prompt first would be a second yes.
  // The webhooks tools only record names and URLs (lib/webhooks.ts); a relay needs the user's own signed-in Weft account.
  // The board view runs a fixed set of operations and never hands back a secret (electron/board-view.cjs).
  // The simulator tools only reach a sandboxed device, the way the browser tools only reach the pane (lib/simulator-tools.ts).
  if (["mcp__browser__", "mcp__secrets__", "mcp__webhooks__", "mcp__devservers__", "mcp__board_view__", "mcp__simulator__"].some((p) => toolName.startsWith(p))) return true;
  return toolName.startsWith("mcp__board__") && SAFE_BOARD_TOOLS.has(toolName.slice("mcp__board__".length));
}
