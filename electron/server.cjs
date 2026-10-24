// Runs the Next.js server and keeps it running: restarts it if it crashes, and writes its output
// to a log file. Three modes: `next dev` (npm run desktop), `next start` (npm run app), and the
// standalone server bundled inside the packaged app, run with Electron's own Node.
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const { freePort } = require("./free-port.cjs");
const { readTail, TAIL_BYTES } = require("./server-log.cjs");
const { noteExit } = require("./server-exit.cjs");

const ROOT = path.join(__dirname, "..");
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 2 * 60_000;
const RECOVER_GRACE_MS = 500;
// Heap cap on next dev so we fail fast and visibly if retention grows. 4 GB is enough headroom for a
// long-running dev session with the board, the pane, and a few active cards (the OOMs we saw were
// SIGABRT-from-v8, not allocator-pressure; they're easier to root-cause when the size is fixed).
// Set low for easy opt-in via env: NEXT_DEV_HEAP_MB=2048 next dev …
const NEXT_DEV_HEAP_MB = Number(process.env.NEXT_DEV_HEAP_MB) || 4096;

// Tail of the child's stdout/stderr to inspect for recoverable errors. The pure parser that backs
// this lives at `lib/dev-server.ts`; this inline copy is a few lines so the main process doesn't
// need a TS loader. lib/dev-server.test.ts is the contract.
const PEER_RE = /Another next dev server is already running\.[\s\S]*?- Local:\s+http:\/\/127\.0\.0\.1:(\d+)[\s\S]*?- PID:\s+(\d+)/;
const MISSING_RE = /Module not found: Can't resolve ['"]([^'"]+)['"]/g;
// v8's "JavaScript heap out of memory" goes to stderr right before the process aborts with SIGABRT.
// We restart instead of looping the crash budget, but emit a status so the on-screen bar can show
// the real reason (six of these in three days were the root cause of every "Stopped when the app
// closed" review card).
const OOM_RE = /(JavaScript heap out of memory|out of memory and was aborted)/;
const RELATIVE_PROBES = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

function tailOf(buf) {
  if (buf.length <= TAIL_BYTES) return buf;
  return buf.slice(buf.length - TAIL_BYTES);
}

function resolveSpec(spec, repoRoot) {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("file://")) {
    const rel = spec.startsWith("file://") ? new URL(spec).pathname : spec;
    const base = path.resolve(repoRoot, rel);
    for (const probe of RELATIVE_PROBES) {
      const candidate = `${base}${probe}`;
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {}
    }
    return null;
  }
  return path.join(repoRoot, "node_modules", spec, "package.json");
}

// Returns { kind: "peer", pid, port } | { kind: "module-not-found", spec, exists } |
// { kind: "oom", message } | null. Inline copy of the parser in lib/dev-server.ts — keep it in sync.
function classifyTail(buf) {
  const tail = tailOf(buf);
  const peerMatch = tail.match(PEER_RE);
  if (peerMatch) {
    const port = Number(peerMatch[1]);
    const pid = Number(peerMatch[2]);
    if (Number.isFinite(pid) && Number.isFinite(port) && pid > 0) return { kind: "peer", pid, port };
  }
  // OOM precedes module-not-found on purpose: v8 aborts right after the heap message, so that is
  // the actual cause even if a missing-path was the last thing Next was chasing.
  const oomMatch = tail.match(OOM_RE);
  if (oomMatch) return { kind: "oom", message: oomMatch[0] };
  const misses = [...tail.matchAll(MISSING_RE)];
  if (misses.length) {
    const spec = misses[misses.length - 1][1];
    const resolved = resolveSpec(spec, ROOT);
    let exists = false;
    if (resolved) {
      try { exists = fs.existsSync(resolved); } catch {}
    }
    return { kind: "module-not-found", spec, exists };
  }
  return null;
}

function killPid(pid) {
  try { process.kill(pid, "SIGTERM"); } catch {}
}

function logFile(app) {
  const file = path.join(app.getPath("logs"), "server.log");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.statSync(file).size > MAX_LOG_BYTES) fs.renameSync(file, `${file}.old`);
  } catch {}
  return file;
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

async function pickPort(preferred) {
  if (await portIsFree(preferred)) return preferred;
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`The server didn't start at ${url}`);
}

function command(port, app) {
  if (app.isPackaged) {
    const serverJs = path.join(process.resourcesPath, "server", "server.js");
    // Run it as "Weft Helper", so macOS doesn't see a second Weft app (and quitting by name works).
    const name = app.getName();
    const helper = path.join(process.resourcesPath, "..", "Frameworks", `${name} Helper.app`, "Contents", "MacOS", `${name} Helper`);
    return {
      bin: fs.existsSync(helper) ? helper : process.execPath,
      args: [serverJs],
      cwd: path.dirname(serverJs),
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        // Weft's own skills (plugin/ in the repo), shipped next to the server; see lib/skills.ts.
        WEFT_PLUGIN_DIR: path.join(process.resourcesPath, "plugin"),
        // The splash's art, inside app.asar; the browser pane (Electron) reads file:// from there. See lib/show.ts.
        WEFT_ASSETS_DIR: path.join(__dirname, "assets"),
      },
    };
  }
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const mode = process.env.WEFT_PROD ? "start" : "dev";
  return {
    bin: process.env.npm_node_execpath || "node",
    args: [nextBin, mode, "-H", "127.0.0.1", "-p", String(port)],
    cwd: ROOT,
    env: {
      // next dev's default heap is sized for a CI box; ours grew past it and v8 aborted (SIGABRT),
      // taking the app down. An explicit cap makes the ceiling predictable.
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--max-old-space-size=${NEXT_DEV_HEAP_MB}`].filter(Boolean).join(" "),
    },
  };
}

// Starts the server and supervises it. onStatus(text) reports restarts; onFatal(message) fires after
// repeated crashes; onNotify(event) is the unified push channel for any state that isn't a mark or
// fatal — status messages carry kind:"status", fatal messages carry kind:"fatal". onMark("port")
// times freeing the port for the startup timer. Returns { url, stop, restart, logPath, wasReady }.
//
// `app`, `spawn` and `freePort` are injected so tests can run without Electron, and without the real
// freePort evicting whatever holds the port (in a test run, Weft's own live server). In production they're loaded
// here on demand; in tests they come in through the same parameter (electron/server.test.ts).
async function startServer({ preferredPort, env, onStatus, onFatal, onMark, onNotify, app: appArg, spawn: spawnArg, freePort: freePortArg }) {
  const app = appArg ?? require("electron").app;
  const spawn = spawnArg ?? require("node:child_process").spawn;
  const evict = freePortArg ?? freePort;
  // From source the board always lives on one port: evict any stale server (and its build folder)
  // instead of wandering to another port, so two servers never share `.next`.
  if (!app.isPackaged) {
    evict(preferredPort, process.env.WEFT_PROD ? undefined : process.env.WEFT_DIST || ".next");
  }
  const port = await pickPort(preferredPort);
  onMark?.("port");
  const url = `http://127.0.0.1:${port}`;
  const logPath = logFile(app);
  const log = fs.createWriteStream(logPath, { flags: "a" });
  let proc;
  let stopping = false;
  let ready = false;
  let crashes = [];
  let startedAt = Date.now();
  // The pids this process killed on purpose (stop() / restart()), so the exit log can say whether a
  // SIGTERM was ours or came from outside Weft.
  const deliberate = new Set();
  let failStart;
  const startFailed = new Promise((_, reject) => (failStart = reject));
  startFailed.catch(() => {});

  function status(text) {
    onStatus?.(text);
    onNotify?.({ kind: "status", text });
  }

  // The child's recent output can name a cause we can recover from without burning the crash budget:
  // a peer dev server (Next 16.4's project-wide guard), a stale "Module not found" for a path that
  // does exist on disk, or a v8 heap OOM. Returns true when it handled the exit and scheduled a
  // relaunch. Kept out of the exit handler so that handler stays small enough to read.
  function recoverFrom(classified) {
    if (classified?.kind === "peer") {
      log.write(`--- weft: killing peer dev server pid ${classified.pid} (port ${classified.port})\n`);
      killPid(classified.pid);
      crashes = [];
      status("Restarting…");
      setTimeout(launch, RECOVER_GRACE_MS);
      return true;
    }
    if (classified?.kind === "module-not-found" && classified.exists) {
      const dist = process.env.WEFT_DIST || ".next";
      const distPath = path.join(ROOT, dist);
      log.write(`--- weft: stale module resolution for "${classified.spec}"; removing ${dist} and retrying\n`);
      try { fs.rmSync(distPath, { recursive: true, force: true }); } catch {}
      crashes = [];
      status("Restarting…");
      setTimeout(launch, RECOVER_GRACE_MS);
      return true;
    }
    if (classified?.kind === "oom") {
      // Don't count a heap OOM against the crash budget: a fresh server starts clean, and looping
      // restarts just re-OOMs. Tell the user the real reason, then restart once.
      log.write(`--- weft: the server ran out of heap (${classified.message}); heap cap ${NEXT_DEV_HEAP_MB} MB, restarting clean\n`);
      crashes = [];
      status("Server ran out of memory — restarting…");
      onNotify?.({ kind: "oom", text: `The server ran out of memory (heap cap ${NEXT_DEV_HEAP_MB} MB) and restarted.` });
      setTimeout(launch, RECOVER_GRACE_MS);
      return true;
    }
    return false;
  }

  function launch() {
    const { bin, args, cwd, env: modeEnv } = command(port, app);
    log.write(`\n--- ${new Date().toISOString()} starting: ${path.basename(bin)} ${args.join(" ")}\n`);
    const child = spawn(bin, args, { cwd, env: { ...process.env, ...env, ...modeEnv }, stdio: ["ignore", "pipe", "pipe"] });
    proc = child;
    startedAt = Date.now();
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        log.write(chunk);
        if (!app.isPackaged) process.stdout.write(chunk);
      });
    }
    child.on("exit", (code, signal) => {
      // Why the dev server died. code 143 / SIGTERM means something outside Next asked it to stop —
      // Weft itself (stop/restart), a stale-port eviction, or something we don't yet know. Log enough
      // to tell those apart next time: the pid, how long it lived, and whether this process called
      // .kill() (deliberate) or nobody here did (external).
      const livedMs = Date.now() - startedAt;
      log.write(
        `--- server exited (code ${code}, signal ${signal}) pid ${child.pid} after ${(livedMs / 1000).toFixed(1)}s` +
          `${deliberate.has(child.pid) ? " [weft asked: stop/restart]" : " [external SIGTERM]"}\n`,
      );
      // Something outside Weft stopped it: say when, so the next server can name the card that did (lib/crash-blame.ts).
      noteExit({ code, signal, asked: stopping || deliberate.has(child.pid) });
      // Ignore a process that was stopped on purpose or already replaced.
      if (stopping || proc !== child) return;
      // A cause we know how to recover from? Handle it and relaunch without counting a crash.
      if (recoverFrom(classifyTail(readTail(logPath)))) return;
      const now = Date.now();
      crashes = [...crashes.filter((t) => now - t < RESTART_WINDOW_MS), now];
      if (crashes.length > MAX_RESTARTS) {
        const message = `The server stopped ${crashes.length} times in two minutes.`;
        if (ready) {
          // The board is up. onFatal is the legacy single-consumer path; onNotify is the unified
          // push so a renderer can draw a bar without the splash taking over the window. Both
          // fire so the existing onFatal wiring (e.g. startup.fail in main.cjs) can still react.
          onFatal?.(message);
          onNotify?.({ kind: "fatal", text: message });
        } else {
          failStart(new Error(message));
        }
        return;
      }
      status("Restarting…");
      setTimeout(launch, 500);
    });
  }

  launch();
  await Promise.race([waitForServer(`${url}/api/cards`), startFailed]);
  ready = true;

  return {
    url,
    port,
    logPath,
    // True after the server first answered /api/cards; used by main.cjs to decide whether a fatal
    // should splash-fail (startup) or push to the board (runtime).
    get wasReady() {
      return ready;
    },
    // The supervised process; changes when it restarts. In dev this is `next dev`'s launcher.
    get pid() {
      return proc?.pid;
    },
    stop() {
      stopping = true;
      if (proc?.pid) deliberate.add(proc.pid);
      proc?.kill();
    },
    async restart() {
      const old = proc;
      proc = undefined;
      if (old?.pid) deliberate.add(old.pid);
      old?.kill();
      crashes = [];
      launch();
      await waitForServer(`${url}/api/cards`);
    },
  };
}

module.exports = { startServer };
