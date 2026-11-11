// The ReplyBox's placeholder text: the question prompt, the "working" line, or the suggestion
// with the Tab cue. Pure, so a test can pin the rules.
export function replyPlaceholder(live: boolean, suggestion: string | undefined, fallback: string, question: boolean): string {
  if (question) return "Type your own answer, or a note on your pick. Enter answers.";
  // The chip already says it queues (lib/reply-mode.ts).
  if (live) return "Write the next message: @ mentions, / skills";
  return suggestion ? `${suggestion}  ⇥ Tab` : fallback;
}