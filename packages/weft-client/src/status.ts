// Threads end each reply with a line like
//   BOARD STATUS: column=review | stage=First shot | remaining=add a test, commit
// (the format is set by the thread instructions in lib/settings.ts). The board reads it
// to move the card, and strips it from what it shows.

export type StatusColumn = "needs_you" | "review" | "done";

export interface BoardStatus {
  column: StatusColumn;
  stage?: string;
  remaining?: string;
}

// Markdown may wrap the whole line or just the label ("**BOARD STATUS:** column=..."), so the
// emphasis marks around the colon are skipped too.
const STATUS_LINE = /^[\s>*_`]*BOARD STATUS[*_`]*:[\s*_`]*(.*?)[\s*_`]*$/i;

// An opening code fence: three or more backticks or tildes, indented at most three spaces.
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function normalizeColumn(raw: string | undefined): StatusColumn | undefined {
  const value = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "needs_you" || value === "review" || value === "done") return value;
  return undefined;
}

function parseFields(raw: string): BoardStatus | undefined {
  const fields: Record<string, string> = {};
  for (const part of raw.split("|")) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    fields[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim();
  }
  const column = normalizeColumn(fields.column);
  if (!column) return undefined;
  const remaining = fields.remaining && !/^none\.?$/i.test(fields.remaining) ? fields.remaining : undefined;
  return { column, stage: fields.stage || undefined, remaining };
}

// Marks the lines inside closed fenced code blocks. A fence that never closes marks nothing, so a
// stray ``` can't hide the real status line after it.
function fencedLines(lines: string[]): boolean[] {
  const inside = lines.map(() => false);
  let open: { marker: string; at: number } | undefined;
  lines.forEach((line, i) => {
    const fence = line.match(FENCE)?.[1];
    if (!open) {
      if (fence) open = { marker: fence, at: i };
      return;
    }
    // A closing fence uses the same character, at least as many, and nothing after it.
    if (fence && fence[0] === open.marker[0] && fence.length >= open.marker.length && !line.trim().slice(fence.length).trim()) {
      for (let j = open.at; j <= i; j++) inside[j] = true;
      open = undefined;
    }
  });
  return inside;
}

// Returns the text without any BOARD STATUS lines, and the last valid status found. A line quoted
// inside a code block is left alone: the thread is showing it, not declaring it.
export function extractStatus(text: string): { text: string; status?: BoardStatus } {
  let status: BoardStatus | undefined;
  const kept: string[] = [];
  const lines = text.split("\n");
  const inside = fencedLines(lines);
  for (const [i, line] of lines.entries()) {
    const match = inside[i] ? null : line.match(STATUS_LINE);
    if (match) {
      status = parseFields(match[1] ?? "") ?? status;
      continue;
    }
    kept.push(line);
  }
  // Removing the line can leave a double blank line behind; fold it back to one.
  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd(), status };
}
