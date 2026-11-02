#!/usr/bin/env node
// Read-only status of a Weft Worker before a live parity pass (docs/architecture/project-hosts.md):
//   1. the worker clone's checked-out commit against origin/main (ls-remote, so nothing is fetched or written);
//   2. whether the daemon is running (launchd's zip.weft.worker, systemd's weft-worker, else ps);
//   3. the SQL to run in Supabase's SQL editor for its cloud_workers row and the migrations the pass needs.
// It never reads the worker home's files (worker.json, worker.env, seal-key.json, worker.log) and holds no token,
// so it can't query the row itself. Usage: node scripts/live-pass-status.mjs [--clone <dir>] [--name m1mini] [--json]
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LAUNCHD_LABEL = "zip.weft.worker";
const SYSTEMD_UNIT = "weft-worker";
const DAEMON_MATCH = "scripts/weft-worker.ts start";

// The migrations the parity pass leans on, each with an object it creates, since one applied by hand in the SQL editor
// isn't in supabase_migrations. Ones from open PRs are marked, so a miss there is expected until they merge.
const col = (table, column) =>
  `exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = '${table}' and column_name = '${column}')`;
const fn = (name) =>
  `exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${name}')`;
const allows = (constraint, value) =>
  `coalesce((select pg_get_constraintdef(oid) like '%''${value}''%' from pg_constraint where conname = '${constraint}'), false)`;
export const MIGRATIONS = [
  ["20261102094800", "host_command (H2 result column)", "main", col("cloud_commands", "result")],
  ["20261102121500", "worker_upkeep (presence topics)", "main", fn("worker_presence_topics")],
  ["20261102130000", "passkey_approvals (H7)", "main", col("devices", "passkey_id")],
  ["20261102141500", "worker_projects (H4 snapshots)", "main", "to_regclass('public.cloud_worker_projects') is not null"],
  ["20261102150000", "device_registry (H10, sign_key)", "main", col("cloud_workers", "sign_key")],
  ["20261102160000", "line_command (H6 line kind)", "main", allows("cloud_commands_kind_check", "line")],
  ["20261102170000", "secret_use (H8)", "main", fn("worker_secret_ask")],
  ["20261102180000", "host_settings (WP3)", "PR #44", fn("worker_account_settings")],
  ["20261102190000", "worker_tunnels (T3)", "main", fn("worker_tunnel_open")],
  ["20261102200000", "signed_widening (C, pin kind)", "PR #49", allows("cloud_commands_kind_check", "pin")],
  ["20261102210000", "worker_board_tools (T1)", "PR #43", fn("worker_new_card")],
  ["20261102230000", "worker_vault_connectors (T2, connector kind)", "branch parity/worker-secrets-connectors",
    allows("cloud_commands_kind_check", "connector")],
];

export function parseArgs(argv) {
  const opts = { clone: path.join(os.homedir(), ".weft-worker", "weft"), name: "m1mini", json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--clone") opts.clone = argv[++i];
    else if (arg === "--name") opts.name = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!opts.clone || !opts.name) throw new Error("--clone and --name each need a value");
  return opts;
}

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20_000, ...opts }).trim();
  } catch {
    return null;
  }
}

const git = (clone, ...args) => run("git", ["-C", clone, ...args]);

export function commitStatus(clone, exec = git) {
  const head = exec(clone, "rev-parse", "HEAD");
  if (!head) return { ok: false, error: `${clone} is not a git checkout` };
  const branch = exec(clone, "rev-parse", "--abbrev-ref", "HEAD");
  const subject = exec(clone, "log", "-1", "--format=%s", "HEAD");
  const dirty = (exec(clone, "status", "--porcelain", "--untracked-files=no") ?? "").split("\n").filter(Boolean).length;
  const remote = exec(clone, "ls-remote", "origin", "refs/heads/main");
  const main = remote ? remote.split(/\s+/)[0] : null;
  let behind = null;
  let ahead = null;
  if (main && exec(clone, "cat-file", "-e", `${main}^{commit}`) !== null) {
    behind = Number(exec(clone, "rev-list", "--count", `HEAD..${main}`));
    ahead = Number(exec(clone, "rev-list", "--count", `${main}..HEAD`));
  }
  return { ok: true, head, branch, subject, dirty, main, behind, ahead };
}

// What the auto-updater would say about this clone (docs/architecture/weft-worker.md#auto-updates).
export function updateNote(c) {
  if (!c.ok) return c.error;
  if (!c.main) return "origin/main unreachable (offline?)";
  if (c.head === c.main) return "up to date with origin/main";
  if (c.branch !== "main") return `off main (${c.branch}): the updater won't touch it`;
  if (c.dirty) return `${c.dirty} local change(s): the updater won't touch it`;
  if (c.ahead) return `ahead of origin/main by ${c.ahead}: the updater won't touch it`;
  const count = c.behind === null ? "behind (count unknown: newest main not fetched yet)" : `${c.behind} commit(s) behind`;
  return `${count}; updates itself once no card on it has a live turn`;
}

function psTable() {
  const out = run("ps", ["-axo", "pid=,ppid=,etime=,command="]) ?? "";
  return out.split("\n").map((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    return m ? { pid: Number(m[1]), ppid: Number(m[2]), etime: m[3], command: m[4] } : null;
  }).filter(Boolean);
}

function serviceStatus(platform) {
  if (platform === "darwin") {
    const out = run("launchctl", ["list", LAUNCHD_LABEL]);
    if (out === null) return { manager: "launchd", loaded: false };
    const pid = out.match(/"PID"\s*=\s*(\d+)/);
    const last = out.match(/"LastExitStatus"\s*=\s*(-?\d+)/);
    return { manager: "launchd", loaded: true, pid: pid ? Number(pid[1]) : null, lastExit: last ? Number(last[1]) : null };
  }
  if (platform === "linux") {
    const state = run("systemctl", ["--user", "is-active", SYSTEMD_UNIT]);
    return { manager: "systemd", loaded: state !== null, active: state };
  }
  return { manager: "none" };
}

export function daemonStatus(platform = process.platform, table = psTable(), service = serviceStatus(platform)) {
  const daemon = table.find((p) => p.command.includes(DAEMON_MATCH));
  const kids = daemon ? table.filter((p) => p.ppid === daemon.pid) : [];
  const clis = kids.filter((p) => /claude|codex|puku|goose/.test(p.command)).length;
  return {
    service,
    running: Boolean(daemon),
    pid: daemon?.pid ?? null,
    uptime: daemon?.etime ?? null,
    cliProcesses: clis,
  };
}

const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function rowSql(name) {
  return `-- Run in Supabase's SQL editor (read-only). Fresh = online/busy and last_seen_at under ~6 min old
-- (the slow beat writes every 5 min while presence is up; the board reads presence first).
select id, name, kind, status, build, update_note, last_seen_at,
       now() - last_seen_at as age,
       (status in ('online', 'busy') and last_seen_at > now() - interval '6 minutes') as fresh,
       public_key is not null as has_box_key, sign_key is not null as paired, revoked_at
from public.cloud_workers
where name = ${sqlString(name)}
order by last_seen_at desc nulls last;`;
}

export function migrationSql() {
  const rows = MIGRATIONS.map(([v, what, from, check]) => `select ${sqlString(v)} as version, ${sqlString(what)} as what, ${sqlString(from)} as lands_with, (${check}) as present`);
  return `-- Which of the pass's migrations this database has (one from a PR missing is expected until it merges).
${rows.join("\nunion all ")}
order by version;

-- Every migration since H6 rewrites these two check lists whole, so the last one applied wins: each list must
-- still name line, secret_use and (once merged) pin and connector, and the tools tunnel_open, relay_create.
select conname, pg_get_constraintdef(oid) from pg_constraint
where conname in ('cloud_commands_kind_check', 'device_calls_tool_check');`;
}

function printText(report, name) {
  const c = report.commit;
  const d = report.daemon;
  console.log("Weft Worker live-pass status\n");
  console.log("1. Commit");
  if (c.ok) {
    console.log(`   clone       ${report.clone}`);
    console.log(`   checked out ${c.head.slice(0, 7)} on ${c.branch}: ${c.subject}`);
    console.log(`   origin/main ${c.main ? c.main.slice(0, 7) : "unknown"}`);
  }
  console.log(`   => ${updateNote(c)}\n`);
  console.log("2. Daemon");
  const s = d.service;
  if (s.manager === "launchd") {
    console.log(`   launchd ${LAUNCHD_LABEL}: ${s.loaded ? `loaded, pid ${s.pid ?? "none"}, last exit ${s.lastExit ?? "?"}` : "not loaded"}`);
  } else if (s.manager === "systemd") {
    console.log(`   systemd ${SYSTEMD_UNIT}: ${s.active ?? "unknown"}`);
  }
  console.log(d.running
    ? `   => running, pid ${d.pid}, up ${d.uptime}, ${d.cliProcesses} CLI process(es) under it (warm spares count too)`
    : "   => not running");
  console.log("\n3. cloud_workers row (no token here: run this yourself)\n");
  console.log(rowSql(name));
  console.log("\n4. Migrations\n");
  console.log(migrationSql());
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const report = { clone: opts.clone, commit: commitStatus(opts.clone), daemon: daemonStatus() };
  report.note = updateNote(report.commit);
  if (opts.json) console.log(JSON.stringify({ ...report, sql: { row: rowSql(opts.name), migrations: migrationSql() } }, null, 2));
  else printText(report, opts.name);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
