// The agent-question form's handle and props. The form itself is components/QuestionForm.tsx; these
// types live here so the reply box's key handling (lib/use-reply-keys.ts) can name them without
// reaching into a component. The component re-exports them.

import type { KeyboardEvent } from "react";
import type { PendingPermission, Question, QuestionReply } from "@/lib/types";

export interface QuestionFormHandle {
  // A key pressed in the reply box; true when the form used it (only with an empty box and no modifiers).
  key(e: KeyboardEvent, boxEmpty: boolean): boolean;
  // Enter in the reply box: answers the shown question with the box's text, then moves on or sends.
  enter(): void;
}

export interface QuestionProps {
  questions: Question[];
  // A folder outside the project that a question names (lib/runner-ask.ts): "Read from <path>" grants it.
  readScope?: PendingPermission["readScope"];
  // The options' preview page (lib/question-preview.ts), shown in the card's browser pane.
  previewUrl?: string;
  // A promise that rejects brings the form back, so a failed send can be tried again.
  onAnswer: (answers: Record<string, string>, annotations: NonNullable<QuestionReply["annotations"]>) => unknown;
  // Declines the question: "Skip" (empty chat) or "Chat about this" with the box's text, which the agent reads instead.
  onDecline?: (chat: string) => unknown;
  // The parent persists the read scope, which the live session's folder guard reads (lib/read-scope.ts).
  onReadScope?: (path: string) => void;
}
