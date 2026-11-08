import fs from "node:fs";
import path from "node:path";

// The SQL a Bash command runs against a database, for the same review a database MCP call gets (lib/db-calls.ts):
// `psql -c "…"` / `--command=…`, `psql -f file.sql` / `--file`, a heredoc into psql, and `prisma db execute --file`.
// A file is read from the card's folder; one that isn't there (or is huge) leaves the call unreviewed, like any other
// Bash command. Commands that run SQL Weft can't see (`supabase db push`, `prisma migrate deploy`) aren't covered here.

const MAX_FILE = 1_000_000;
const QUOTED = String.raw`(?:"((?:[^"\\]|\\.)*)"|'([^']*)')`;
const COMMAND = new RegExp(String.raw`\bpsql\b[^\n;&|]*?(?:-c|--command)(?:\s+|=)${QUOTED}`);
const FILE = /\b(?:psql\b[^\n;&|]*?(?:-f|--file)|prisma db execute\b[^\n;&|]*?--file)(?:\s+|=)("[^"]+"|'[^']+'|\S+)/;
const HEREDOC = /\bpsql\b[^\n]*<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n\s*\2\b/;

function readSql(file: string, cwd: string): string | undefined {
  try {
    const abs = path.resolve(cwd, file.replace(/^["']|["']$/g, ""));
    if (fs.statSync(abs).size > MAX_FILE) return undefined;
    return fs.readFileSync(abs, "utf8");
  } catch {
    return undefined;
  }
}

export interface BashSql {
  tool: "psql" | "prisma";
  sql: string;
  name?: string;
}

export function bashSql(command: string, cwd: string): BashSql | undefined {
  const inline = COMMAND.exec(command);
  if (inline) return { tool: "psql", sql: inline[1] !== undefined ? inline[1].replace(/\\(.)/g, "$1") : (inline[2] as string) };
  const heredoc = HEREDOC.exec(command);
  if (heredoc) return { tool: "psql", sql: heredoc[3] as string };
  const file = FILE.exec(command);
  const sql = file ? readSql(file[1] as string, cwd) : undefined;
  if (!file || sql === undefined) return undefined;
  return { tool: command.includes("prisma") ? "prisma" : "psql", sql, name: path.basename((file[1] as string).replace(/["']/g, "")) };
}
