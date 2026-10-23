// Diagnostic: watch the Weft Electron main process itself, not just the dev server.
//
// The dev server's log says its exits are "[external SIGTERM]" and that Weft's own supervisor
// never asked for them. That points above Weft: something is terminating the whole Electron app,
// which takes `next dev` down with it. This polls Electron's pid every 200ms so a death shows up
// as the pid changing, and records what was running alongside it at that moment.
//
//   node scripts/watch-app.mjs

import { execSync } from "node:child_process";
import fs from "node:fs";

const MARK = "weft/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron";
const LOG = "/tmp/weft-app-watch.log";

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return "";
  }
}

function electronPid() {
  const out = sh(`pgrep -f ${JSON.stringify(MARK)}`);
  const first = out.split("\n").filter(Boolean)[0];
  return first ? Number(first) : null;
}

function devPids() {
  return sh(`pgrep -f ${JSON.stringify("next/dist/bin/next dev -H 127.0.0.1 -p 1024")}`)
    .split("\n")
    .filter(Boolean)
    .map(Number);
}

function line(pid) {
  return sh(`ps -o pid=,ppid=,lstart=,etime= -p ${pid} 2>/dev/null`).trim();
}

function log(msg) {
  const stamped = `[${new Date().toISOString()}] ${msg}`;
  console.log(stamped);
  try {
    fs.appendFileSync(LOG, `${stamped}\n`);
  } catch {}
}

let last = electronPid();
log(`watching Electron; current main pid ${last} (${last ? line(last) : "none"})`);

setInterval(() => {
  const now = electronPid();
  if (now === last) return;
  if (last === null) {
    log(`Electron appeared: pid ${now} — ${line(now)}`);
  } else if (now === null) {
    const dev = devPids();
    log(`Electron GONE: pid ${last} was ${line(last)}`);
    log(`  next dev still alive: ${dev.length ? dev.join(",") : "none"}`);
  } else {
    log(`Electron CHANGED: ${last} -> ${now}`);
    log(`  old: ${line(last)}`);
    log(`  new: ${line(now)}`);
  }
  last = now;
}, 200);