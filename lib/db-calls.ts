import { bashSql } from "./db-bash";
import { safeUpdate, type Pending, type Session } from "./runner-state";
import { pendingView, settle } from "./runner-pending";
import { reviewSql } from "./sql-review";
import { lossClause, whatItLoses } from "./sql-loss";
import { scanSql, staticallyHarmless } from "./sql-scan";
import { settings, save } from "./settings-store";
import { getCard, getThread, replaceThreadItem } from "./store";
import type { PendingSql, SqlReview } from "./types";

// Database-writing tool calls and the prompts they cause. The Supabase MCP confirms destructive SQL with an
// elicitation that names no SQL ("Run it on project X?"); the SQL is in the execute_sql / apply_migration call that
// triggered it. So the stream records each database call while it runs (lib/runner-turn.ts), a prompt that comes up
// meanwhile gets that call's SQL (lib/runner-ask.ts askUser), and a second model reviews it in the background
// (lib/sql-review.ts): the prompt shows at once, and the verdict fills in when it lands (components/SqlReview.tsx).
// The user still decides, unless they turned on Settings → Security → "Accept harmless SQL" (sqlAutoAccept).

// The MCP tools that run SQL, and where their input keeps it. A new database MCP is one more row.
const DB_TOOLS: { pattern: RegExp; sql: (input: Record<string, unknown>) => unknown; name?: (input: Record<string, unknown>) => unknown }[] = [
  // The Supabase MCP, local or the claude.ai connector: execute_sql { query }, apply_migration { name, query }.
  { pattern: /^mcp__(.*supabase.*)__(execute_sql|apply_migration)$/i, sql: (i) => i.query, name: (i) => i.name },
  // Postgres MCPs (postgres-mcp's execute_sql { sql }, server-postgres's query { sql }).
  { pattern: /^mcp__(.*(?:postgres|pg).*)__(execute_sql|query)$/i, sql: (i) => i.sql ?? i.query },
];

export type DbCall = Omit<PendingSql, "flagged" | "review" | "autoAccepted">;

// The SQL a tool call runs, or undefined when it isn't a database call (or carries no SQL). A Bash command counts
// when it runs SQL through psql or prisma (lib/db-bash.ts); its files are read from `cwd`.
export function dbCall(toolName: string, input: Record<string, unknown>, cwd?: string): DbCall | undefined {
  if (toolName === "Bash") {
    const found = typeof input.command === "string" && cwd ? bashSql(input.command, cwd) : undefined;
    return found && { server: "bash", ...found };
  }
  for (const tool of DB_TOOLS) {
    const m = tool.pattern.exec(toolName);
    const sql = m && tool.sql(input);
    if (!m || typeof sql !== "string" || !sql.trim()) continue;
    const name = tool.name?.(input);
    return { server: m[1] as string, tool: m[2] as string, sql, ...(typeof name === "string" && name ? { name } : {}) };
  }
  return undefined;
}

// An MCP server's name as its tools' prefix spells it ("claude.ai Supabase" → claude_ai_supabase).
const serverKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_");

// Called for each tool_use the stream sees, and each tool_result: the database calls running right now.
export function trackDbCall(session: Session, id: string, toolName: string, input: Record<string, unknown>) {
  const call = dbCall(toolName, input);
  if (!call) return;
  (session.dbCalls ??= new Map()).set(id, call);
}

export function endDbCall(session: Session, id: string) {
  session.dbCalls?.delete(id);
}

// The running database call an MCP server's elicitation is about: the newest one on that server, else the newest.
export function inFlightCall(session: Session, serverName: string): DbCall | undefined {
  const calls = [...(session.dbCalls?.values() ?? [])].reverse();
  return calls.find((c) => serverKey(c.server) === serverKey(serverName)) ?? calls[0];
}

export function pendingSql(call: DbCall): PendingSql {
  const scan = scanSql(call.sql);
  const loses = lossClause(whatItLoses(scan.statements));
  return { ...call, flagged: scan.flagged, ...(loses && { loses }) };
}

// The SQL a prompt shows: the elicitation's in-flight call, or the database call being asked about.
export function promptSql(session: Session, toolName: string, input: Record<string, unknown>, elicitingServer?: string): PendingSql | undefined {
  const call = elicitingServer ? inFlightCall(session, elicitingServer) : dbCall(toolName, input, session.spec.cwd);
  return call && pendingSql(call);
}

// SQL with nothing flagged (a SELECT, a CREATE) needs no model: the static scan's own Safe, at once.
export const STATIC_MODEL = "static";
const staticSafe = (): Promise<SqlReview> =>
  Promise.resolve({ verdict: "safe", summary: "Nothing in it deletes, drops or changes access.", statements: [], concerns: [], model: STATIC_MODEL });

export function sqlAutoAccept(): boolean {
  return settings().sqlAutoAccept === true;
}

export function setSqlAutoAccept(on: boolean) {
  settings().sqlAutoAccept = on;
  save();
}

// Harmless enough to accept unasked: the reviewer said Safe, and the static scan agrees (nothing loses data, no DROP
// left without its CREATE, no DELETE or UPDATE without WHERE). A form to fill in is never answered for you.
export function harmless(sql: PendingSql, review: SqlReview, p: Pick<Pending, "elicitation">): boolean {
  return review.verdict === "safe" && !review.error && staticallyHarmless(scanSql(sql.sql)) && !p.elicitation?.fields.length;
}

// Reviews the prompt's SQL in the background. The prompt is already on the card; the review goes into it when it
// lands, if it's still waiting. With "Accept harmless SQL" on, or "Allow safe SQL" on this card, a harmless one is
// accepted and the thread says why.
export function reviewPrompt(cardId: string, session: Session, p: Pending, review = reviewSql): Promise<void> {
  const sql = p.sql;
  if (!sql) return Promise.resolve();
  return (sql.flagged.length ? review(sql.sql, sql.name) : staticSafe()).then((r) => {
    if (!session.pending.includes(p)) return;
    p.sql = { ...sql, review: r };
    if ((sqlAutoAccept() || getCard(cardId)?.safeSql) && harmless(sql, r, p)) autoAccept(cardId, p, r);
    else if (session.pending[0] === p && !p.waiting) safeUpdate(cardId, { pending: pendingView(p) });
  });
}

// Puts the SQL on a prompt that has some (see promptSql) and starts its review.
export function attachSql(cardId: string, session: Session, p: Pending) {
  p.sql = promptSql(session, p.toolName, p.input, p.elicitation?.server);
  if (p.sql) void reviewPrompt(cardId, session, p);
}

function autoAccept(cardId: string, p: Pending, review: SqlReview) {
  p.sql = { ...(p.sql as PendingSql), autoAccepted: true };
  settle(cardId, true, undefined, p.id);
  const item = getThread(cardId)[p.index];
  if (item?.kind === "permission") replaceThreadItem(cardId, p.index, { ...item, auto: review.model === STATIC_MODEL ? "nothing in the SQL deletes or changes access" : `the ${review.model} review said Safe` });
}
