import fs from "node:fs";
import { rewindPoint } from "./edit-last";
import { sessionFiles } from "./import";

// Where to resume a Claude session so it drops the turn `promptId` started (see rewindPoint), read from
// the session's transcript in ~/.claude/projects. Undefined when there's no transcript to read.
export function sessionRewindPoint(sessionId: string, promptId: string) {
  const file = sessionFiles().get(sessionId);
  try {
    return file ? rewindPoint(fs.readFileSync(file, "utf8"), promptId) : undefined;
  } catch {
    return undefined;
  }
}

// The session's latest assistant entry, so a cron made from the end of a thread forks it as it is now and not
// with the turns it takes later. Undefined when there's no transcript, or no reply in it yet.
export function sessionTip(sessionId: string): string | undefined {
  const file = sessionFiles().get(sessionId);
  try {
    const lines = file ? fs.readFileSync(file, "utf8").trimEnd().split("\n") : [];
    for (const line of lines.reverse()) {
      const entry = JSON.parse(line) as { type?: string; uuid?: string };
      if (entry.type === "assistant" && entry.uuid) return entry.uuid;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
