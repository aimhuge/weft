import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { summarizeInput, toolAction } from "./format";
import { MEDIA_REF, attachmentName } from "./media";
import { extractReview } from "./review";
import { extractStatus } from "./status";
import { adoptLocalMedia, pastedImages, toolResult } from "./thread-media";
import type { ThreadItem } from "./types";

// Turns a Claude Code session's transcript (from getSessionMessages) into thread items, so a session
// picked up from Claude Code reads like a thread that ran on the board: what the user typed, what the
// assistant said, and the tools it ran with their results. Text the CLI adds to user messages for
// the model (reminders, hook output, task notifications, command output) is left out.

// getSessionMessages returns a few more fields than SessionMessage declares.
type Message = SessionMessage & {
  timestamp?: string;
  is_meta?: boolean;
  isCompactSummary?: boolean;
  isCompletedLocalCommand?: boolean;
  origin?: { kind?: string };
};

interface Block {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

// User messages from these sources were sent by the CLI or another session, not typed by the user.
const NOT_TYPED = new Set([
  "task-notification",
  "peer",
  "coordinator",
  "observer",
  "observer-activity",
  "auto-continuation",
]);

// Sections the CLI, a hook or Weft (the <weft-env> block, lib/turn-env.ts) embeds in otherwise real user text.
const EMBEDDED = /<(system-reminder|user-prompt-submit-hook|weft-env)>[\s\S]*?<\/\1>/g;

// User text that starts like this was added by the CLI.
const INJECTED =
  /^(?:<(?:system-reminder|command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|task-notification|user-prompt-submit-hook|cross-session-message|agent-message|bash-stdout|bash-stderr)[\s>]|\[Request interrupted|Caveat: The messages below were generated)/;

// A slash command the user typed, like "/commit fix the build", from the tags the CLI stores it as.
function slashCommand(text: string): string | undefined {
  const name = text.match(/<command-name>\s*([^<\s]+)\s*<\/command-name>/)?.[1];
  if (!name) return undefined;
  const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
  return `${name.startsWith("/") ? name : `/${name}`}${args ? ` ${args}` : ""}`;
}

// The part of a user message's text the user typed, or undefined when it's all CLI-added.
function typedText(raw: string, localCommand: boolean): string | undefined {
  const text = raw.replace(EMBEDDED, "").trim();
  if (!text) return undefined;
  // Local commands (/clear, /model) only changed the CLI; commands that prompt the model stay.
  if (/^<command-(?:name|message|args)>/.test(text)) return localCommand ? undefined : slashCommand(text);
  const bash = text.match(/^<bash-input>([\s\S]*?)<\/bash-input>/);
  if (bash) return `! ${(bash[1] ?? "").trim()}`;
  if (INJECTED.test(text)) return undefined;
  return text;
}

// The text the user typed in one line of a session's .jsonl file (empty for anything else), for the search index.
export function typedPromptOf(record: Record<string, unknown>): string {
  if (record.type !== "user" || record.isSidechain || record.isMeta || record.isCompactSummary) return "";
  if (NOT_TYPED.has((record.origin as { kind?: string } | undefined)?.kind ?? "")) return "";
  const content = (record.message as { content?: unknown } | undefined)?.content;
  return blocksOf(content)
    .flatMap((b) => {
      const text = b.type === "text" ? typedText(b.text ?? "", Boolean(record.isCompletedLocalCommand)) : undefined;
      return text ? [text] : [];
    })
    .join("\n\n");
}

function blocksOf(content: unknown): Block[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content.filter((b): b is Block => typeof b === "object" && b !== null) : [];
}

// True when text refers to a file in the attachments folder, as messages sent from Weft do.
function hasAttachmentRef(text: string) {
  return [...text.matchAll(MEDIA_REF)].some((m) => attachmentName(m[2] ?? m[3] ?? ""));
}

// cwd resolves relative paths in the images the agent shows.
export function transcriptToThread(messages: SessionMessage[], options?: { maxItems?: number; cwd?: string }): ThreadItem[] {
  const maxItems = options?.maxItems ?? 400;
  const cwd = options?.cwd ?? process.cwd();
  const items: ThreadItem[] = [];
  // Each tool call's index in items, so its result (in a later user message) can be attached.
  const tools = new Map<string, number>();

  for (const msg of messages as Message[]) {
    // Subagent turns stay out of the thread; their final report arrives as a tool result.
    if (msg.parent_tool_use_id) continue;
    const at = msg.timestamp ? Date.parse(msg.timestamp) || 0 : 0;
    const message = (msg.message ?? {}) as { content?: unknown; model?: string };
    const blocks = blocksOf(message.content);

    if (msg.type === "assistant") {
      for (const block of blocks) {
        if (block.type === "text") {
          const { text } = extractReview(extractStatus(block.text ?? "").text);
          // The CLI's filler after an interrupted turn.
          if (message.model === "<synthetic>" && text.trim() === "No response requested.") continue;
          if (text.trim()) items.push({ kind: "assistant", text: adoptLocalMedia(text, cwd), at });
        } else if (block.type === "tool_use" && block.id) {
          const input = (block.input ?? {}) as Record<string, unknown>;
          tools.set(block.id, items.length);
          const name = block.name ?? "tool";
          items.push({ kind: "tool", id: block.id, name, summary: summarizeInput(input), action: toolAction(name, input), at });
        }
      }
      continue;
    }

    if (msg.type !== "user") continue;
    for (const block of blocks) {
      if (block.type !== "tool_result" || !block.tool_use_id) continue;
      const index = tools.get(block.tool_use_id);
      const item = index === undefined ? undefined : items[index];
      if (index === undefined || item?.kind !== "tool") continue;
      items[index] = { ...item, ...toolResult(block.content), isError: Boolean(block.is_error) };
    }

    const fromCli = msg.is_meta || msg.isCompactSummary || NOT_TYPED.has(msg.origin?.kind ?? "");
    if (fromCli) continue;
    const texts = blocks.flatMap((b) => {
      const text = b.type === "text" ? typedText(b.text ?? "", Boolean(msg.isCompletedLocalCommand)) : undefined;
      return text ? [text] : [];
    });
    // Images pasted into Claude Code arrive as image blocks; ones sent from Weft are already in the
    // text as attachment refs, with an image block after each.
    if (!texts.some(hasAttachmentRef)) {
      const images = pastedImages(blocks);
      if (images.length) texts.unshift(images.join("\n"));
    }
    if (texts.length) items.push({ kind: "user", text: texts.join("\n\n"), at });
  }

  // A tool call with no result that the conversation moved on from was cut off (the CLI quit or was
  // interrupted); give it an empty result so it doesn't look like it's still running.
  let moved = false;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!item) continue;
    if (item.kind !== "tool") moved = true;
    else if (moved && item.result === undefined) items[i] = { ...item, result: "" };
  }

  return items.length > maxItems ? items.slice(-maxItems) : items;
}
