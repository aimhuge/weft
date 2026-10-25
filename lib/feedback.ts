// The feedback dot (components/FeedbackDot.tsx): Haiku interviews you about what's in your way, then writes a summary
// you check before it's sent. Every sent summary is kept in ~/.weft/feedback/ (lib/feedback-store.ts) and goes on to
// the Weft team's Slack through the deployed Weft (lib/feedback-send.ts). Pure, so the board's hook
// (lib/use-feedback.ts) can import it.

export interface FeedbackMessage {
  role: "user" | "assistant";
  text: string;
}

export interface FeedbackSummary {
  title: string;
  body: string;
}

export interface FeedbackTurn {
  reply: string;
  // Set once Haiku has heard enough (or you asked it to wrap up): what would be sent.
  summary: FeedbackSummary | null;
}

export const FEEDBACK_OPENER = "Hi! I'm here to pass what's in your way on to the people building Weft. What's the problem you're running into?";
export const MAX_MESSAGES = 30;
export const MAX_TEXT = 4000;
export const MAX_TITLE = 120;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// The transcript the board sent, checked: user and assistant messages with text, clipped, the newest kept.
export function cleanMessages(input: unknown): FeedbackMessage[] {
  if (!Array.isArray(input)) throw new Error("messages must be a list.");
  const messages = (input as unknown[])
    .filter((m): m is FeedbackMessage => {
      const { role, text } = (typeof m === "object" && m !== null ? m : {}) as Record<string, unknown>;
      return (role === "user" || role === "assistant") && typeof text === "string" && text.trim() !== "";
    })
    .map((m) => ({ role: m.role, text: clip(m.text.trim(), MAX_TEXT) }))
    .slice(-MAX_MESSAGES);
  if (!messages.some((m) => m.role === "user")) throw new Error("Say what's in your way first.");
  return messages;
}

export function cleanSummary(input: unknown): FeedbackSummary {
  const { title, body } = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  if (typeof title !== "string" || !title.trim() || typeof body !== "string" || !body.trim()) throw new Error("summary needs a title and a body.");
  return { title: clip(title.trim(), MAX_TITLE), body: clip(body.trim(), MAX_TEXT) };
}

const transcript = (messages: FeedbackMessage[]) => messages.map((m) => `${m.role === "user" ? "User" : "You"}: ${m.text}`).join("\n\n");

const ABOUT = "Weft is a desktop kanban board where every card is an AI coding thread, with a browser pane beside the board.";
const SUMMARY_SHAPE = '{"title": "<under 80 characters>", "body": "<3 to 6 short markdown bullets: the goal, what goes wrong, how often, the impact, what they want>"}';
const SUMMARY_STYLE = 'Write the summary in the third person ("The user…"), in plain words, keeping their specifics (names of features, error text, steps).';

// One interview turn: the next question, or the summary once Haiku has heard enough.
export function turnPrompt(messages: FeedbackMessage[]): string {
  const asked = messages.filter((m) => m.role === "assistant").length;
  return [
    `You interview a user of Weft about a problem they face, so the team building it can fix it. ${ABOUT}`,
    "Ask one short, friendly follow-up question at a time: what they were trying to do, what happened instead, how often, what it cost them, what they'd want. Two to four questions are usually enough; never ask what they already told you.",
    "",
    "The conversation so far:",
    transcript(messages),
    "",
    `You've asked ${asked} question${asked === 1 ? "" : "s"} so far. When you understand the problem well enough for an engineer to act on it, stop asking and write the summary.`,
    'Answer with JSON only, no code fence: {"reply": "<your next question>", "summary": null} while interviewing, or',
    `{"reply": "<one line: thanks, here is what will be sent>", "summary": ${SUMMARY_SHAPE}} when done.`,
    SUMMARY_STYLE,
  ].join("\n");
}

// The summary now, however far the interview got: the "That's all" button.
export function summaryPrompt(messages: FeedbackMessage[]): string {
  return [
    `Summarize what a user of Weft told you about a problem they face, for the team building it. ${ABOUT}`,
    "",
    "The conversation:",
    transcript(messages),
    "",
    `Answer with JSON only, no code fence: ${SUMMARY_SHAPE}`,
    SUMMARY_STYLE,
  ].join("\n");
}

export const WRAP_REPLY = "Thanks! Here's what I'll send to the Weft team. Check it, then send it or add more.";
export const WRAP_FAILED = "Sorry, I couldn't write the summary. Try again, or tell me a bit more.";

// The summary prompt's answer as a turn.
export function parseSummary(text: string): FeedbackTurn {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  try {
    return { reply: WRAP_REPLY, summary: cleanSummary(JSON.parse(text.slice(start, end + 1))) };
  } catch {
    return { reply: WRAP_FAILED, summary: null };
  }
}

// Haiku's answer as a turn. Text that isn't the JSON asked for is taken as a plain reply.
export function parseTurn(text: string): FeedbackTurn {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const raw = JSON.parse(text.slice(start, end + 1)) as { reply?: unknown; summary?: unknown };
      if (typeof raw.reply === "string" && raw.reply.trim()) {
        let summary: FeedbackSummary | null = null;
        try {
          if (raw.summary) summary = cleanSummary(raw.summary);
        } catch {
          summary = null;
        }
        return { reply: raw.reply.trim(), summary };
      }
    } catch {
      // Not JSON after all: fall through to the plain reply.
    }
  }
  const reply = text.trim();
  return { reply: reply || "Sorry, I lost my train of thought. Could you say that again?", summary: null };
}
