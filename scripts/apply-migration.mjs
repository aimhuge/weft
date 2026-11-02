#!/usr/bin/env node
// Applies one reviewed Supabase migration file to Weft Prod through the Management API, the way the MCP's
// apply_migration does: one transaction with the version recorded in supabase_migrations.schema_migrations.
// Refuses a version that's already applied. The token is read from the Supabase CLI's token file and never printed.
// Usage: node scripts/apply-migration.mjs <path/to/YYYYMMDDHHMMSS_name.sql>
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const PROJECT = "lqjyravglujyizyqypxq";
const file = process.argv[2];
const match = file && /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(basename(file));
if (!match) {
  console.error("usage: node scripts/apply-migration.mjs <path/YYYYMMDDHHMMSS_name.sql>");
  process.exit(2);
}
const [, version, name] = match;
const token = readFileSync(join(homedir(), ".supabase", "access-token"), "utf8").trim();

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

const applied = await query(`select count(*)::int as n from supabase_migrations.schema_migrations where version = '${version}'`);
if (applied[0]?.n) {
  console.log(`${version}_${name} is already applied; nothing to do.`);
  process.exit(0);
}
const sql = readFileSync(file, "utf8");
await query(`begin;\n${sql}\ninsert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}');\ncommit;`);
const after = await query(`select version, name from supabase_migrations.schema_migrations where version = '${version}'`);
console.log(after.length ? `applied ${version}_${name}` : `NOT recorded: ${version}_${name}`);
process.exit(after.length ? 0 : 1);
