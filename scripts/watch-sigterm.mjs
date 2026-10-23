// Diagnostic: catch who is sending SIGTERM to the dev server.
//
// The supervisor's log says the exits are "external", but not who sent them. This watches
// `next dev` and, the instant it binds port 1024, polls its own parentage every 100ms so a
// crash shows either the child being replaced or its ppid changing underneath it.
// Run it from the repo root:  node scripts/watch-sigterm.mjs
import { execSync } from "node:child_process";

const PORT = 1024;
const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function listeners() {
  try {
    return sh(`lsof -nP -t -iTCP:${PORT} -sTCP:LISTEN`).split("\n").filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

function ps(pid) {
  try {
    return sh(`ps -o pid=,ppid=,stat=,command= -p ${pid}`).trim();
  } catch {
    return "";
  }
}

function pgrep(pattern) {
  try {
    return sh(`pgrep -fl ${JSON.stringify(pattern)}`).trim();
  } catch {
    return "";
  }
}

let last = null;
let seen = 0;

function report(tag) {
  const now = new Date().toISOString();
  console.log(`[${now}] ${tag}`);
  const own = listeners();
  if (own.length) for (const pid of own) console.log(`    listener ${pid}: ${ps(pid)}`);
  const launcher = pgrep("next/dist/bin/next");
  if (launcher) console.log(`    launcher:\n      ${launcher.split("\n").join("\n      ")}`);
}

console.log(`watching port ${PORT}; poll every 100ms`);

// Whenever the listener set changes, dump who is on it. A kill shows up as the pid vanishing
// between two samples; a takeover as a new pid appearing.
setInterval(() => {
  const now = listeners().sort().join(",") || "-";
  if (now !== last) {
    if (last !== null) {
      report(last === "-" ? "server started" : `server ${last === now ? "went away" : "changed"}: ${last} -> ${now}`);
      seen++;
    }
    last = now;
  }
}, 100).unref?.();

setInterval(() => {}, 1 << 30);