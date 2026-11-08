import { complete } from "./haiku";
import { scanSql, type SqlScan } from "./sql-scan";
import type { SqlReview, SqlVerdict } from "./types";

// A second model reads the SQL a database call is about to run and says, short and plain, what it really does:
// the verdict the prompt shows above Accept (components/SqlReview.tsx). It judges; it never answers the prompt.
// The static scan (lib/sql-scan.ts) goes in with the SQL, so the model starts from the statements that matter.

// Sonnet: on a 564-line migration with a DELETE without WHERE, an UPDATE ... WHERE true and a DROP POLICY never
// re-created buried in it, both Haiku and Sonnet named all three, but Sonnet answered in 11s to Haiku's 22-28s
// (2026-11-08, docs/architecture/sql-review.md). The prompt can't move on that long anyway; the review fills in.
export const REVIEW_MODEL = "sonnet";
// Past this the SQL is cut, and the review says so: a review of half a migration still beats none.
const MAX_SQL = 80_000;
const VERDICTS: SqlVerdict[] = ["safe", "access", "deletes", "unknown"];

export function reviewPrompt(sql: string, scan: SqlScan, name?: string): string {
  const cut = sql.length > MAX_SQL;
  const flagged = scan.statements.map((s) => `- [${s.kind}] ${s.text.slice(0, 200)}`).join("\n") || "- (none)";
  return `You review SQL an AI coding agent is about to run on a live Postgres (Supabase) database. A human must Accept or Decline it, and cannot read it all. Judge it; do not reassure. If in doubt, say so.

Verdict, exactly one:
- "deletes": rows, columns, tables or schemas can be lost or overwritten (DELETE, TRUNCATE, UPDATE, DROP TABLE/COLUMN, a type change that can lose values).
- "access": no data is lost, but who can read or write changes (policies dropped or re-created with different rules, GRANT/REVOKE, RLS turned off).
- "safe": nothing is lost and access ends up the same (e.g. a policy dropped and re-created identically, an index or function replaced).
- "unknown": you can't tell (dynamic SQL, the SQL is cut, it depends on data you can't see).

Reply with only this JSON, no prose around it:
{"verdict":"...","summary":"one line: what the SQL does overall","statements":[{"sql":"the destructive statement, shortened to 80 chars","does":"what it actually does, in plain words"}],"loss":"what data is lost and whether it can be recovered (omit if none)","concerns":["anything that looks wrong: a DROP with no matching CREATE, DELETE/UPDATE without WHERE, a type change on a populated column, access widened to anon/public, statements that contradict the migration's name"]}

List every destructive statement (DROP, DELETE, TRUNCATE, UPDATE, ALTER ... DROP/TYPE, REVOKE, DISABLE RLS), at most 12; group repeats. Keep each "does" under 20 words. "concerns" may be [].

A static scan flagged these statements:
${flagged}
${scan.concerns.length ? `It also noted:\n${scan.concerns.map((c) => `- ${c}`).join("\n")}\n` : ""}${name ? `\nMigration name: ${name}\n` : ""}${cut ? `\nThe SQL is ${sql.length} characters; only the first ${MAX_SQL} follow.\n` : ""}
<sql>
${sql.slice(0, MAX_SQL)}
</sql>`;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// The model's reply as a review; one that isn't the JSON asked for is "Can't tell", with why.
export function parseReview(text: string, model: string): SqlReview {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  let raw: Record<string, unknown>;
  try {
    raw = json ? (JSON.parse(json) as Record<string, unknown>) : {};
  } catch {
    raw = {};
  }
  const verdict = VERDICTS.find((v) => v === raw.verdict);
  if (!verdict) return failed(model, "The reviewer's answer didn't read as a review.");
  const statements = (Array.isArray(raw.statements) ? raw.statements : []).flatMap((s: unknown) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return str(o.does) ? [{ sql: str(o.sql), does: str(o.does) }] : [];
  });
  const concerns = (Array.isArray(raw.concerns) ? raw.concerns : []).map(str).filter(Boolean);
  const loss = str(raw.loss);
  return { verdict, summary: str(raw.summary), statements, concerns, ...(loss && { loss }), model };
}

export function failed(model: string, error: string): SqlReview {
  return { verdict: "unknown", summary: "", statements: [], concerns: [], model, error };
}

// One review per SQL text: the plain permission prompt and the server's elicitation for the same call share it.
const cache = new Map<string, Promise<SqlReview>>();
const CACHE_SIZE = 20;

export function reviewSql(sql: string, name?: string, run: (prompt: string, model: string) => Promise<string> = complete): Promise<SqlReview> {
  const key = `${name ?? ""}\n${sql}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const review = run(reviewPrompt(sql, scanSql(sql), name), REVIEW_MODEL).then(
    (text) => parseReview(text, REVIEW_MODEL),
    (err: unknown) => failed(REVIEW_MODEL, err instanceof Error ? err.message : "The reviewer didn't answer."),
  );
  cache.set(key, review);
  // A failed review isn't kept, so the next prompt for the same SQL tries again.
  void review.then((r) => r.error && cache.get(key) === review && cache.delete(key));
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return review;
}

export function clearReviewCache() {
  cache.clear();
}
