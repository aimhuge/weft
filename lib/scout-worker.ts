// Re-scout for a worker project (docs/architecture/project-hosts.md, T6). On this Mac the scout is a read-only SDK run
// in the local server (lib/scout.ts) that writes the report the badge reads. A worker's snapshot only republishes the
// report its own disk holds, so the re-scout is a card there: it scouts with the same instructions, then saves the
// findings with the plugin's scout-save.mjs (the file /weft:done's scout writes), which the worker's next publish reads.
import { scoutPrompt } from "./scout-prompt";

export function workerScoutPrompt(): { prompt: string; title: string } {
  const prompt = [
    scoutPrompt().replace("Reply with only a JSON array, no prose:", "Write the findings as a JSON array (no prose) to a file in the system temp folder, findings.json, in this shape:"),
    "",
    "This is read-only for the project: don't edit any of its files, and don't commit. When the file is written, save it where this project's code quality badge reads it:",
    "  node \"$(find \"$HOME\" -path '*skills/done/scout-save.mjs' -not -path '*/node_modules/.cache/*' -print -quit)\" <path to findings.json>",
    "Run it from this project's folder. If no scout-save.mjs is found, say so, and list the findings in your reply instead. Finish by telling me how many findings were saved.",
  ].join("\n");
  return { prompt, title: "Re-scout for refactors" };
}
