import type { ScannedStatement } from "./sql-scan";

// What the statements that lose data lose, each as a short phrase the prompt's Decline hint names
// (components/SqlReview.tsx riskySql): "deletes every row in team_members", "overwrites profiles.github_login".
// From the static scan, so it's there before the review lands. A repeat is named once.

const NAME = String.raw`("[^"]+"|[\w.]+)`;
const name = (raw: string) => raw.replace(/"/g, "").replace(/^public\./, "");

// Like lib/sql-scan.ts bare(), but keeping case, so a quoted "Cards" reads as Cards; the patterns ignore case.
const squash = (text: string) => text.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim();

function phrase(text: string): string {
  const s = squash(text);
  const del = new RegExp(`^delete from (?:only )?${NAME}`, "i").exec(s);
  if (del) return `deletes ${/\bwhere\b/i.test(s) ? "rows" : "every row"} in ${name(del[1] as string)}`;
  const truncate = new RegExp(`^truncate (?:table )?(?:only )?${NAME}`, "i").exec(s);
  if (truncate) return `deletes every row in ${name(truncate[1] as string)}`;
  const update = new RegExp(`^update (?:only )?${NAME}(?: (?:as )?\\w+)? set ${NAME}`, "i").exec(s);
  if (update) return `overwrites ${name(update[1] as string)}.${name(update[2] as string)}`;
  const drop = new RegExp(`^drop (table|schema|database|materialized view|sequence|type|domain|extension) (?:if exists )?${NAME}`, "i").exec(s);
  if (drop) return `drops ${(drop[1] as string).toLowerCase()} ${name(drop[2] as string)}`;
  const table = new RegExp(`^alter table (?:if exists )?(?:only )?${NAME}`, "i").exec(s);
  const column = /\bdrop (?:column )?(?:if exists )?("[^"]+"|\w+)/i.exec(s);
  if (table && column && !/ (?:set data )?type\b/i.test(s)) return `drops column ${name(table[1] as string)}.${name(column[1] as string)}`;
  const retype = /\balter (?:column )?("[^"]+"|\w+) (?:set data )?type\b/i.exec(s);
  if (table && retype) return `changes the type of ${name(table[1] as string)}.${name(retype[1] as string)}`;
  return "runs a block that deletes data";
}

export function whatItLoses(statements: ScannedStatement[]): string[] {
  return [...new Set(statements.filter((s) => s.kind === "loss").map((s) => phrase(s.text)))];
}

// The phrases as one clause: "deletes every row in t, overwrites u.a and 2 more".
export function lossClause(loses: string[], max = 3): string {
  const shown = loses.slice(0, max);
  const more = loses.length - shown.length;
  if (more) return `${shown.join(", ")} and ${more} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1) as string}` : (shown[0] ?? "");
}
