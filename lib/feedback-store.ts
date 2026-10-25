import fs from "node:fs";
import path from "node:path";
import type { FeedbackMessage, FeedbackSummary } from "./feedback";
import { DATA_DIR } from "./store";

// The Mac's copy of every summary the feedback dot sent (lib/feedback.ts), one JSON file each in ~/.weft/feedback/.

export interface FeedbackEntry {
  id: string;
  at: number;
  summary: FeedbackSummary;
  messages: FeedbackMessage[];
  from: { name: string | null; email: string | null } | null;
  version: string | null;
  sent: boolean;
}

export const feedbackDir = () => path.join(DATA_DIR, "feedback");

// Keeps a sent summary on the Mac, with its transcript and whether it reached the team.
export function saveFeedback(entry: FeedbackEntry): string {
  fs.mkdirSync(feedbackDir(), { recursive: true });
  const file = path.join(feedbackDir(), `${new Date(entry.at).toISOString().replace(/[:.]/g, "-")}-${entry.id}.json`);
  fs.writeFileSync(file, JSON.stringify(entry, null, 2));
  return file;
}
