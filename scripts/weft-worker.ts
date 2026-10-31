// `weft-worker`: the Weft Worker's command line (docs/architecture/weft-worker.md). Run from the worker's clone of
// Weft with jiti (install/worker.sh sets up the `weft-worker` wrapper and the launchd or systemd service):
//
//   weft-worker enrol <token> [--name <name>]   trade a one-time token from the app for this box's key
//   weft-worker login                           sign Claude Code in for the daemon (claude setup-token)
//   weft-worker start                           run the daemon (what the service runs)
//   weft-worker status                          say whether this box is enrolled
//   weft-worker check                           load the whole engine and exit (lib/worker-update.ts trusts a commit by this)
//
// The worker keeps its own store (WEFT_DATA under ~/.weft-worker), so a desktop Weft on the same Mac is untouched.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "../lib/supabase-project";
import { readWorkerConfig, workerDataDir, workerHome, workerSealKeys, workRoot, writeWorkerConfig, writeWorkerEnv } from "../lib/worker-config";
import { workerBlobClient, workerMayUpload } from "../lib/worker-blobs";
import { enrol, registry, type Rpc } from "../lib/worker-registry";
import { CLAUDE_TOKEN, GITHUB_PURPOSE, LOGIN_PURPOSE, newSealKeys, open } from "../lib/worker-seal";
import { createUpdater, updatesOn } from "../lib/worker-update";
import { listenForPushes, listenForWakes } from "../lib/worker-wake";

const home = workerHome();
// Before the engine is imported: lib/store.ts reads WEFT_DATA once, at import.
process.env.WEFT_DATA = workerDataDir(home);
// Read by the browser tools and the thread's prompt (lib/worker-pane.ts): no shell here, but pages still reach the pane.
process.env.WEFT_WORKER = "1";

const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const rpc: Rpc = (fn, args) => client.rpc(fn, args);

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function enrolCommand(token: string | undefined) {
  if (!token) throw new Error("Usage: weft-worker enrol <token> [--name <name>]. Get the token in Weft → Settings → Sync → Workers.");
  const name = flag("name") || os.hostname().replace(/\.local$/, "");
  const config = await enrol(rpc, token, { name, platform: process.platform, arch: process.arch });
  writeWorkerConfig(home, config);
  console.log(`Enrolled ${config.name} as ${config.device}. Start it with: weft-worker start`);
}

// The store first, on its own: the engine's modules import each other in a circle, and one that loads before
// lib/store.ts has set DATA_DIR reads it as undefined.
async function loadEngine() {
  const store = await import("../lib/store");
  const parts = await Promise.all([
    import("../lib/card-starter"),
    import("../lib/runner"),
    import("../lib/runner-pending"),
    import("../lib/bus"),
    import("../lib/worker-daemon"),
    import("../lib/worker-publish"),
    import("../lib/worker-paths"),
    import("../lib/worker-github"),
    import("../lib/folder-grant"),
    import("../lib/blob-store"),
    import("../lib/show-dir"),
    import("../lib/worker-pane"),
    import("../lib/runner-state"),
    import("../lib/worker-recover"),
    import("../lib/resume"),
    import("../lib/worker-screen"),
    import("../lib/simulator-input"),
  ]);
  return { store, parts };
}

async function checkCommand() {
  await loadEngine();
  console.log("This build loads.");
  process.exit(0);
}

async function startCommand() {
  const config = readWorkerConfig(home);
  if (!config) throw new Error("This box isn't enrolled yet. Run: weft-worker enrol <token>");
  const { store, parts } = await loadEngine();
  const [{ startFeatureCard }, runner, pending, { subscribe }, { createDaemon }, { createPublisher }, paths, github, folderGrant, { createBlobStore }, { SHOW_DIR }, { setPageUpload }, { busyCards }, { recoverCards }, { resumeInterrupted }, { nudgeScreen, openScreenChannel, setScreenChannel }, { sendInput }] = parts;
  const reg = registry(rpc, config.key);
  // The public half goes on the worker's row, so Settings → Sync → Workers can seal a Claude token to this box.
  const keys = workerSealKeys(home, newSealKeys);
  await reg.setPublicKey(keys.publicKey).catch((err: unknown) => console.log(`Weft Worker: publishing its key: ${(err as Error).message}`));
  let restart: () => void = () => process.exit(0);
  const root = workRoot(home);
  // Pages go up through the key-checked route, and only from the show folder and the checkouts (lib/worker-blobs.ts).
  const blobs = createBlobStore({ client: workerBlobClient(config.key, client.storage), mayUpload: (file) => workerMayUpload(file, [SHOW_DIR, root]) });
  setPageUpload((file) => blobs.uploadPage(file, config.orgId));
  setScreenChannel((topic) => openScreenChannel(client, topic));
  const publisher = createPublisher(reg, store, console.warn, { blobs, orgId: config.orgId });
  subscribe(publisher.hear);
  const daemon = createDaemon({
    reg,
    publisher,
    listen: (hooks) => listenForWakes(client, config.key, hooks, console.log),
    listenForPushes: (hooks) => listenForPushes(client, hooks, console.log),
    onCardChange: subscribe,
    engine: {
      start: (body) => startFeatureCard(body),
      reply: (id, text) => runner.sendUserMessage(id, text),
      answer: (id, allow, answers, pendingId) => pending.answerPermission(id, allow, answers, pendingId),
      grant: folderGrant.applyFolderGrant,
      stop: (id) => runner.stop(id),
      setMode: (id, mode) => runner.setPermissionMode(id, mode),
      input: (input) => sendInput(input).finally(() => nudgeScreen(input.device)),
      getCard: store.getCard,
      live: () => busyCards().length > 0,
      holding: () => busyCards().flatMap((id) => {
        const card = store.getCard(id);
        return card ? [{ title: card.title, asking: Boolean(card.pending) }] : [];
      }),
      recover: () => recoverCards(store),
      resume: resumeInterrupted,
    },
    update: updatesOn(home, process.cwd()) ? { ...createUpdater({ home, dir: process.cwd() }), restart: () => restart() } : undefined,
    async checkout(folder, repo) {
      const dir = paths.repoPath(root, folder);
      if ((await paths.materialise(dir, repo)) === "cloned") console.log(`Weft Worker: cloned ${repo} into ${dir}`);
      return dir;
    },
    async clone(folder, repo) {
      const dir = paths.repoPath(root, folder);
      if ((await paths.cloneProject(dir, repo)) === "cloned") console.log(`Weft Worker: cloned ${repo} into ${dir}`);
    },
    // No restart: git asks its credential helper afresh each time.
    github: { login: (sealed) => github.signInGithub(home, open(keys, sealed, GITHUB_PURPOSE)), status: () => github.githubStatus() },
    // A sign-in from the desktop: save the token where the wrapper loads it, then restart (the service brings the
    // daemon straight back), so no CLI started before it, warm spares included, runs signed out.
    login(sealed) {
      const token = open(keys, sealed, LOGIN_PURPOSE);
      if (!CLAUDE_TOKEN.test(token)) throw new Error("That isn't a Claude Code token.");
      writeWorkerEnv(home, { CLAUDE_CODE_OAUTH_TOKEN: token });
      console.log("Weft Worker: signed Claude Code in; restarting to use it.");
      setTimeout(() => restart(), 1_500);
      return Promise.resolve();
    },
  });
  const stop = daemon.start();
  console.log(`Weft Worker ${config.name} (${config.device}) is running. Work root ${root}.`);
  const quit = () => void stop().finally(() => process.exit(0));
  restart = quit;
  process.on("SIGTERM", quit);
  process.on("SIGINT", quit);
}

// Asks for a line without echoing it, so the token doesn't sit on screen or in the terminal's scrollback.
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (stdin.isTTY) stdin.setRawMode(true);
    let line = "";
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.off("data", onData);
          stdin.pause();
          process.stdout.write("\n");
          resolve(line.trim());
          return;
        }
        if (ch === "\u0003") process.exit(130);
        line = ch === "\u007f" ? line.slice(0, -1) : line + ch;
      }
    };
    stdin.on("data", onData).resume();
  });
}

// Signs Claude Code in for the daemon's CLIs. A background service can't answer the keychain prompt a desktop login
// raises, so the worker uses a long-lived token from `claude setup-token`, kept in worker.env (mode 600).
async function loginCommand() {
  const bundled = path.join(process.cwd(), "node_modules", "@anthropic-ai", `claude-agent-sdk-${process.platform}-${process.arch}`, "claude");
  const claude = fs.existsSync(bundled) ? bundled : "claude";
  console.log("Signing Claude Code in for this worker. Open the link it prints, approve, then paste the token it shows.\n");
  const done = spawnSync(claude, ["setup-token"], { stdio: "inherit" });
  if (done.status !== 0) throw new Error("claude setup-token didn't finish.");
  const token = await askHidden("\nPaste the token (it isn't shown): ");
  if (!/^sk-ant-[\w-]+$/.test(token)) throw new Error("That doesn't look like a Claude Code token (sk-ant-…).");
  writeWorkerEnv(home, { CLAUDE_CODE_OAUTH_TOKEN: token });
  console.log(`Saved to ${path.join(home, "worker.env")}. Restart the worker to use it: weft-worker restart`);
}

function statusCommand() {
  const config = readWorkerConfig(home);
  console.log(config ? `Enrolled: ${config.name} (${config.device}), workspace ${config.orgId}` : "Not enrolled. Run: weft-worker enrol <token>");
}

const [command, arg] = process.argv.slice(2);
const commands: Record<string, () => unknown> = { enrol: () => enrolCommand(arg), login: loginCommand, start: startCommand, status: statusCommand, check: checkCommand };
Promise.resolve((commands[command ?? ""] ?? (() => console.log("Usage: weft-worker enrol <token> | login | start | status | restart | update")))()).catch((err: unknown) => {
  const e = err as Error;
  console.error(process.env.WEFT_WORKER_DEBUG ? e.stack : e.message);
  process.exit(1);
});
