// A static read of the SQL a database call runs, with no model: which statements drop, delete or change access,
// the lines they sit on (the prompt highlights them, components/SqlReview.tsx), and what plainly looks wrong.
// It is the floor under the model's review (lib/sql-review.ts): "Accept harmless SQL" needs both to agree.
// Conservative on purpose: a DELETE inside a DO block or a function body still counts.

// loss: rows, columns or tables can go; drop: an object holding no data goes (a policy, function, view, index);
// access: who may read or write changes (GRANT, REVOKE, RLS off, an altered policy).
export type StatementKind = "loss" | "drop" | "access";

export interface ScannedStatement {
  kind: StatementKind;
  text: string;
  // 0-based first and last line of the statement in the SQL.
  from: number;
  to: number;
}

export interface SqlScan {
  statements: ScannedStatement[];
  flagged: number[];
  concerns: string[];
}

interface Piece {
  text: string;
  start: number;
  end: number;
}

// The end of a dollar quote's body ($$ ... $$ or $tag$ ... $tag$), or -1 when `at` doesn't open one.
function dollarEnd(sql: string, at: number): number {
  const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(at))?.[0];
  if (!tag) return -1;
  const close = sql.indexOf(tag, at + tag.length);
  return close === -1 ? sql.length : close + tag.length;
}

// Where the quoted string, identifier or comment starting at `i` ends (one past it), or -1 when none starts there.
function skipQuoted(sql: string, i: number): number {
  const c = sql[i];
  if (c === "-" && sql[i + 1] === "-") {
    const nl = sql.indexOf("\n", i);
    return nl === -1 ? sql.length : nl;
  }
  if (c === "/" && sql[i + 1] === "*") {
    const close = sql.indexOf("*/", i + 2);
    return close === -1 ? sql.length : close + 2;
  }
  if (c === "'" || c === '"') {
    let j = i + 1;
    while (j < sql.length && !(sql[j] === c && sql[j + 1] !== c)) j += sql[j] === c ? 2 : 1;
    return Math.min(j + 1, sql.length);
  }
  if (c === "$") return dollarEnd(sql, i);
  return -1;
}

// The statements, split on top-level semicolons (not ones inside strings, comments or dollar quotes).
export function splitStatements(sql: string): Piece[] {
  const pieces: Piece[] = [];
  let start = 0;
  let i = 0;
  while (i < sql.length) {
    const skip = skipQuoted(sql, i);
    if (skip !== -1) {
      i = skip;
      continue;
    }
    if (sql[i] === ";") {
      pieces.push({ text: sql.slice(start, i), start, end: i });
      start = i + 1;
    }
    i++;
  }
  pieces.push({ text: sql.slice(start), start, end: sql.length });
  return pieces.filter((p) => bare(p.text));
}

// A statement with its comments gone and its whitespace collapsed, lowercased, for matching.
export function bare(text: string): string {
  return text
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const LOSS_DROP = /^drop (table|schema|database|materialized view|sequence|type|domain|extension)\b/;
const OBJECT_DROP = /^drop (policy|function|procedure|view|trigger|index|rule|publication|role)\b/;
const ACCESS = /^(grant|revoke|alter default privileges|alter policy|alter role)\b|disable row level security|no force row level security/;
const ALTER_LOSS = /^alter table\b.*\b(drop (column\b|(?!constraint|default|not null|identity|expression|policy)["\w])|(alter column|alter) [^ ]+ (set data )?type\b)/;
// A body (DO block, function) that deletes, empties or drops a table.
const HIDDEN_LOSS = /\b(delete from|truncate|drop table|drop schema)\b/;

// What one statement does, or undefined when it neither loses data, drops an object nor changes access.
export function statementKind(text: string): StatementKind | undefined {
  const s = bare(text);
  if (/^(truncate|delete|update)\b/.test(s) || LOSS_DROP.test(s) || ALTER_LOSS.test(s)) return "loss";
  if (OBJECT_DROP.test(s) || /^alter table\b.*\bdrop constraint\b/.test(s)) return "drop";
  if (ACCESS.test(s)) return "access";
  if (HIDDEN_LOSS.test(s)) return "loss";
  return undefined;
}

const unquote = (name: string) => name.replace(/"/g, "").replace(/\(.*$/, "");

// The object a DROP or CREATE names, as "policy name on table" / "function name", for matching one with the other.
export function objectKey(text: string): string | undefined {
  const s = bare(text);
  const drop = /^drop (policy|function|procedure|view|trigger|index|rule) (?:if exists )?("[^"]+"|[\w.]+)(?: on ("[^"]+"|[\w.]+))?/.exec(s);
  const create = /^create (?:or replace )?(?:unique )?(?:materialized )?(policy|function|procedure|view|trigger|index|rule) (?:concurrently )?(?:if not exists )?("[^"]+"|[\w.]+)(?: on ("[^"]+"|[\w.]+))?/.exec(s);
  const m = drop ?? create;
  if (!m) return undefined;
  const on = m[1] === "policy" && m[3] ? ` on ${unquote(m[3])}` : "";
  return `${m[1]} ${unquote(m[2] as string)}${on}`;
}

// What plainly looks wrong: a DELETE or UPDATE with no WHERE, an object dropped and never made again.
function concernsOf(pieces: Piece[]): string[] {
  const out: string[] = [];
  const created = new Set(pieces.flatMap((p) => (/^create\b/.test(bare(p.text)) ? [objectKey(p.text)] : [])));
  for (const p of pieces) {
    const s = bare(p.text);
    const target = /^(?:delete from|update) (?:only )?("[^"]+"|[\w.]+)/.exec(s)?.[1];
    if (target && !/\bwhere\b/.test(s)) out.push(`${s.startsWith("delete") ? "DELETE" : "UPDATE"} on ${unquote(target)} has no WHERE: it touches every row.`);
    if (/^truncate\b/.test(s)) out.push(`${s.slice(0, 80)} empties the table.`);
    const key = OBJECT_DROP.test(s) ? objectKey(p.text) : undefined;
    if (key && !created.has(key)) out.push(`DROP ${key} has no matching CREATE: it stays gone.`);
  }
  return out;
}

const lineOf = (sql: string, at: number) => sql.slice(0, at).split("\n").length - 1;

export function scanSql(sql: string): SqlScan {
  const pieces = splitStatements(sql);
  const statements: ScannedStatement[] = pieces.flatMap((p) => {
    const kind = statementKind(p.text);
    if (!kind) return [];
    // The statement's own lines, from its first word, not the blank lines or comments before it.
    const lead = p.text.length - p.text.replace(/^(?:\s|--[^\n]*|\/\*[\s\S]*?\*\/)*/, "").length;
    return [{ kind, text: p.text.slice(lead).trim(), from: lineOf(sql, p.start + lead), to: lineOf(sql, p.end) }];
  });
  const flagged = [...new Set(statements.flatMap((s) => Array.from({ length: s.to - s.from + 1 }, (_, i) => s.from + i)))];
  return { statements, flagged, concerns: concernsOf(pieces) };
}

// Nothing in the SQL loses data and nothing looks wrong: the static half of "harmless".
export function staticallyHarmless(scan: SqlScan): boolean {
  return !scan.concerns.length && scan.statements.every((s) => s.kind !== "loss");
}
