// `weft-worker`: the Weft Worker's command line (docs/architecture/weft-worker.md). Run from the worker's clone of
// Weft with jiti (install/worker.sh sets up the `weft-worker` wrapper and the launchd or systemd service):
//
//   weft-worker enrol <token> [--name <name>]   pair with your Mac (a wph.… code) or trade a one-time token (wet_…);
//                                               an enrolled box needs --re-pair --approval wra.…, signed by the Mac
//                                               it trusts now (lib/worker-repair.ts)
//   weft-worker login                           sign Claude Code in for the daemon (claude setup-token)
//   weft-worker start                           run the daemon (what the service runs)
//   weft-worker status                          say whether this box is enrolled, with its key's fingerprint
//   weft-worker forget-macs                     stop taking secrets from the paired Mac (lib/worker-mac-keys.ts)
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
import { MAX_TRAVEL_BYTES, attachmentsOf, receiveAttachments } from "../lib/attachment-transfer";
import { workerBlobClient, workerBlobReader, workerMayUpload, workerResults } from "../lib/worker-blobs";
import { enrol, registry, type Rpc } from "../lib/worker-registry";
import { isPairCode, newSignKeys } from "../lib/host-pairing";
import { pairWorker, workerSignKeys } from "../lib/worker-pair";
import { RTC_PURPOSE } from "../lib/rtc-signal";
import { CLAUDE_TOKEN, GITHUB_PURPOSE, LOGIN_PURPOSE, newSealKeys, open } from "../lib/worker-seal";
import { createUpdater, updatesOn } from "../lib/worker-update";
import { listenForPushes, listenForWakes } from "../lib/worker-wake";
import { joinPresence } from "../lib/worker-presence";
import { browserSandboxNote } from "../lib/worker-chromium";

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
  const { enrolRefusal, macKeysAt } = await import("../lib/worker-mac-keys");
  const enrolled = readWorkerConfig(home);
  // An enrolled box swaps its Mac only on an approval that Mac signed; a fresh one enrols as it always has. A box that
  // trusts a Mac counts as enrolled even when worker.json won't read, so a damaged file can't drop the check.
  const trusts = fs.existsSync(path.join(home, "mac-keys.json"));
  const refused =
    enrolRefusal(Boolean(enrolled) || trusts, process.argv.includes("--re-pair"), process.stdin.isTTY && process.stdout.isTTY) ??
    (enrolled || trusts ? (await import("../lib/worker-repair")).repairRefusal({ pinned: macKeysAt(home).pinned(), worker: enrolled?.workerId ?? "", code: token, approval: flag("approval"), now: Date.now() }) : null);
  if (refused) throw new Error(refused);
  const name = flag("name") || os.hostname().replace(/\.local$/, "");
  // A pairing code (wph.…, Settings → Devices) pairs the box with your Mac; a token (wet_…) is the older one-time trade.
  const config = isPairCode(token)
    ? await pairWorker(token, { name, platform: process.platform, arch: process.arch, boxKey: workerSealKeys(home, newSealKeys).publicKey, sign: workerSignKeys(home, newSignKeys) }, { rpc, say: console.log })
    : await enrol(rpc, token, { name, platform: process.platform, arch: process.arch });
  writeWorkerConfig(home, config);
  // The Mac that showed the code: the one whose signed secret_use rows this box will take (lib/worker-mac-keys.ts).
  // Replaces any Mac trusted before; a token (no Mac key) leaves the box taking no secrets.
  (await import("../lib/worker-mac-keys")).trustPairingMac(home, token);
  console.log(`Enrolled ${config.name} as ${config.device}. Start it with: weft-worker start`);
}

// One module at a time, never side by side in a Promise.all: jiti's async import caches a module as it starts and
// hands that half-run module to any import that asks for it meanwhile, so two branches reaching the same module
// (lib/skills.ts, say) gave the second one undefined exports (PLUGIN_DIR in lib/puku-dotenv.ts). In turn they load
// like plain require(). The store goes first, so DATA_DIR is set before any module reads it.
// scripts/check-worker-engine.mjs loads this function as written, in CI on every PR.
async function loadEngine() {
  const store = await import("../lib/store");
  const parts = await inTurn([
    () => import("../lib/card-starter"),
    // Reached through lib/host-api's handlers now, still loaded here so `check` proves they load.
    () => import("../lib/runner"),
    () => import("../lib/runner-pending"),
    () => import("../lib/bus"),
    () => import("../lib/worker-daemon"),
    () => import("../lib/worker-publish"),
    () => import("../lib/worker-paths"),
    () => import("../lib/worker-github"),
    () => import("../lib/folder-grant"),
    () => import("../lib/blob-store"),
    () => import("../lib/show-dir"),
    () => import("../lib/worker-pane"),
    () => import("../lib/runner-state"),
    () => import("../lib/worker-recover"),
    () => import("../lib/resume"),
    () => import("../lib/worker-screen"),
    () => import("../lib/simulator-input"),
    () => import("../lib/worker-fast-screen"),
    () => import("../lib/worker-device"),
    () => import("../lib/worker-device-link"),
    () => import("../lib/mobile-app"),
    () => import("../lib/host-api"),
    () => import("../lib/scheduler"),
    () => import("../lib/host-line"),
    () => import("../lib/project-snapshot"),
    () => import("../lib/worker-projects"),
    () => import("../lib/worker-folders"),
    () => import("../lib/worker-secret-run"),
    () => import("../lib/worker-secret-wiring"),
    () => import("../lib/worker-host-services"),
    // Loaded again in start, as the board tools' side (lib/worker-board-link.ts); here so `check` proves they load.
    () => import("../lib/worker-board-link"),
    () => import("../lib/worker-lists"),
    () => import("../lib/cron-run"),
    () => import("../lib/worktree-pool"),
    () => import("../lib/worker-browser-screen"),
    // Loaded again in start, for the LAN path; here so `check` proves multicast-dns is installed.
    () => import("../lib/worker-lan-start"),
  ] as const);
  return { store, parts };
}

// Each loader's module, one after another (see loadEngine), typed as the tuple Promise.all would give.
async function inTurn<T extends readonly (() => Promise<unknown>)[]>(loaders: T): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: unknown[] = [];
  for (const load of loaders) out.push(await load());
  return out as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
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
  const [{ startFeatureCard }, , , { subscribe }, { createDaemon }, { createPublisher }, paths, github, folderGrant, { createBlobStore }, { SHOW_DIR }, { setPageUpload }, { busyCards }, { recoverCards }, { resumeInterrupted }, { openScreenChannel, screenInput, setFastScreen, setScreenChannel, fastScreenOf, watcherOf }, { sendInput }, { openFastScreen }, { setDeviceLink }, { deviceLink }, { isMobileApp }, { runVerb }, { startScheduler }, { createHostLines }, { readProjectSnapshot }, { createProjectPublisher }, { listProjectFolders }, { setSecretLink, forgetOnTurnEnd }, { secretWiring, pairedSigner }, { startHostServices }, , , , { startWorktreePool }, browserScreen] = parts;
  // What a thread's <weft-env> block says about this box: its name, and its commit read once now (lib/host-facts.ts).
  const facts = await import("../lib/host-facts");
  facts.setWorkerName(config.name);
  void facts.warmHostFacts();
  const reg = registry(rpc, config.key);
  // The public half goes on the worker's row, so Settings → Sync → Workers can seal a Claude token to this box.
  const keys = workerSealKeys(home, newSealKeys);
  await reg.setPublicKey(keys.publicKey).catch((err: unknown) => console.log(`Weft Worker: publishing its key: ${(err as Error).message}`));
  let restart: () => void = () => process.exit(0);
  const root = workRoot(home);
  // Pages go up through the key-checked route, and only from the show folder, the checkouts and the files pasted into
  // its cards (lib/worker-blobs.ts), so a thread's pasted picture shows on weft.zip too.
  const attachments = path.join(store.DATA_DIR, "attachments");
  const blobs = createBlobStore({ client: workerBlobClient(config.key, client.storage), mayUpload: (file) => workerMayUpload(file, [SHOW_DIR, root, attachments]) });
  const readBlob = workerBlobReader(config.key, MAX_TRAVEL_BYTES);
  setPageUpload((file) => blobs.uploadPage(file, config.orgId));
  setScreenChannel((topic) => openScreenChannel(client, topic));
  // The worker's browser, live in the pane on the same kind of topic (lib/worker-browser-screen.ts).
  browserScreen.setBrowserScreenChannel((topic) => openScreenChannel(client, topic));
  setDeviceLink(deviceLink(reg, config.key));
  // A card's mcp__secrets__run asks the owner's Mac, and the answer comes back sealed to this box (lib/worker-secret-run.ts).
  // The other secrets tools ask it too (lib/worker-vault.ts).
  const secrets = secretWiring(home, reg, keys);
  setSecretLink(secrets.link);
  subscribe(forgetOnTurnEnd);
  // A card's git and gh get GitHub tokens minted on weft.zip, before any CLI starts (lib/connector-worker.ts).
  const connectors = (await import("../lib/connector-worker")).startWorkerConnectors({ home, workerId: config.workerId, key: config.key, sign: pairedSigner(home), weftDir: process.cwd(), cwdOf: (id) => store.getCard(id)?.cwd, log: console.log });
  setFastScreen(openFastScreen, (sealed) => open(keys, sealed, RTC_PURPOSE));
  // The editor's large answers, under results/ and swept after a day (lib/worker-blobs.ts workerResults).
  const results = workerResults(config.key, client.storage);
  const publisher = createPublisher(reg, store, console.warn, { blobs, orgId: config.orgId });
  subscribe(publisher.hear);
  // Signed widening: the pairing Mac's approvals and its endorsed passkeys lift the network's refusals (lib/worker-signing.ts).
  const { widen, terminal } = (await import("../lib/worker-signing")).workerSigning({ home, workerId: config.workerId, root, listFolders: listProjectFolders, repoPath: paths.repoPath, nameFolder: publisher.nameFolder, heads: reg.passkeyHeads, signHeld: (await import("../lib/worker-secret-wiring")).pairedSigner(home) });
  // The board tools reach the user's board, not this store (docs/architecture/project-hosts.md#board-tools-on-a-worker):
  // the owner's cards, a card for another host, and this worker's crons and webhooks published for the Mac's drawers.
  const [{ setBoardLink }, { createListsPublisher }, { listCrons }, { listWebhooks, onWebhooksWrite }, { startCronClock }] = await inTurn([
    () => import("../lib/worker-board-link"),
    () => import("../lib/worker-lists"),
    () => import("../lib/cron-store"),
    () => import("../lib/webhooks"),
    () => import("../lib/cron-run"),
  ] as const);
  const boardLink = { workerId: config.workerId, root, cards: reg.boardCards, newCard: reg.newCard, setLists: reg.setLists, macCrons: reg.macCrons };
  setBoardLink(boardLink);
  const lists = createListsPublisher(boardLink, { crons: listCrons, webhooks: () => listWebhooks() });
  subscribe((event) => {
    if (event.type === "crons") lists.poke();
  });
  onWebhooksWrite(() => lists.poke());
  // Session lines (lib/host-line.ts): the answer goes back on the board's own topic, events are what the
  // publisher ships (one projection, one upload), screens need a card of this box's own watching them, and verbs run
  // through the host kind's path (the daemon hands `run` in).
  const lines = createHostLines({
    terminal,
    unseal: (sealed, purpose) => open(keys, sealed, purpose),
    answerOn: async (topic, sealed) => {
      const channel = await openScreenChannel(client, topic);
      await channel.answer(sealed).finally(() => setTimeout(() => channel.close(), 5_000));
    },
    hear: (listener) => publisher.mirror(listener),
    screen: (device) => browserScreen.browserScreenOf(device) ?? fastScreenOf(device),
    watcher: (device) => {
      const id = browserScreen.browserWatcherOf(device) ?? watcherOf(device);
      return id ? store.getCard(id) : undefined;
    },
    log: console.log,
  });
  // Your account's settings mirrored in, and this box's plan limits polled and published (lib/worker-host-services.ts).
  const services = startHostServices(reg, console.log, home);
  const daemon = createDaemon({
    reg,
    owner: config.ownerUser,
    publisher,
    listen: (hooks) => listenForWakes(client, config.key, hooks, console.log),
    listenForPushes: (hooks) => listenForPushes(client, hooks, console.log),
    presence: (hooks) => joinPresence(client, config.key, hooks, console.log),
    onCardChange: subscribe,
    // Send later on this worker's cards (card.schedule): the messages are saved on the cards, so one whose time passed
    // while the daemon was down goes on the first check, after recovery, so it can't race a turn being resumed.
    // Crons too: a cron for this worker's project fires here, where its runs' cards work.
    // And the worktree pool for its Isolated cards (lib/worktree-pool.ts), as the Mac's server keeps one.
    onRecovered: () => {
      startScheduler({ briefs: false });
      startCronClock();
      void lists.flush();
      startWorktreePool();
    },
    line: (sealed, run, answerOn) => lines.open(sealed, run, answerOn),
    widen,
    engine: {
      // A card.create names its id (the board's) and may leave the card in Backlog; a run or new_card starts one.
      start: async (body) => {
        services.nudge();
        const card = typeof body.id === "string" ? (await runVerb("card.create", body as never)).card : await startFeatureCard(body);
        return isMobileApp(card.cwd) ? store.updateCard(card.id, { mobileApp: true }) : card;
      },
      // The same handlers the desktop's routes run (lib/host-api): a reply, an answer, a stop, a mode and the rest.
      host: (verb, args) => {
        services.nudge();
        return runVerb(verb, args as never);
      },
      // A verb's result over the row's 4 KB (the editor's files.*) goes up as JSON (lib/host-result.ts).
      carry: (json) => results.put(json),
      receive: (text, payload) => receiveAttachments(text, attachmentsOf(payload), attachments, readBlob),
      grant: folderGrant.applyFolderGrant,
      // A browser device is the card's own headless Chromium; anything else, a simulator.
      input: (input, cardId) => (browserScreen.isBrowserScreen(input.device) ? browserScreen.browserInput(input, cardId) : screenInput(input, sendInput, cardId)),
      setQa: (id, qaDevice) => void store.updateCard(id, { qaDevice }),
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
    // "Browser runs without sandbox", on the worker's row, where Linux won't let its Chromium sandbox itself.
    browserNote: browserSandboxNote(),
    async checkout(folder, repo) {
      const dir = paths.repoPath(root, folder);
      if ((await paths.materialise(dir, repo)) === "cloned") console.log(`Weft Worker: cloned ${repo} into ${dir}`);
      return dir;
    },
    async clone(folder, repo) {
      const dir = paths.repoPath(root, folder);
      if ((await paths.cloneProject(dir, repo)) === "cloned") console.log(`Weft Worker: cloned ${repo} into ${dir}`);
    },
    secretUse: secrets.use,
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
  // Each folder's header reads, for the desktop board's badges (lib/worker-projects.ts).
  const projects = createProjectPublisher({
    folders: () => listProjectFolders(root),
    read: (folder) => readProjectSnapshot(paths.repoPath(root, folder), store.listCards()),
    put: (folder, snapshot) => reg.putProject(folder, snapshot),
    idle: () => busyCards().length === 0,
    log: console.log,
  });
  const stopProjects = projects.start();
  const sweep = () => void results.sweep().catch((err: unknown) => console.log(`Weft Worker: sweeping results: ${(err as Error).message}`));
  sweep();
  const sweepTimer = setInterval(sweep, 60 * 60_000);
  subscribe(() => projects.changed());
  // Tunnels, the relay and dev servers reach the boards through the owner's Mac (lib/worker-reach.ts).
  const { startWorkerReach } = await import("../lib/worker-reach");
  const stopReach = startWorkerReach(reg, console.log);
  // A board on the same LAN offers lines straight here, found by a signed mDNS hint (lib/worker-lan-start.ts).
  const stopLan = await (await import("../lib/worker-lan-start")).startWorkerLanSafely({ home, workerId: config.workerId, boxKey: keys.publicKey, sign: pairedSigner(home), open: daemon.lanLine, log: console.log });
  console.log(`Weft Worker ${config.name} (${config.device}) is running. Work root ${root}.`);
  const quit = () => {
    stopProjects();
    clearInterval(sweepTimer);
    connectors?.close();
    services.stop();
    void Promise.all([stop(), stopReach(), stopLan()]).finally(() => process.exit(0));
  };
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

async function statusCommand() {
  const config = readWorkerConfig(home);
  console.log(config ? `Enrolled: ${config.name} (${config.device}), workspace ${config.orgId}` : "Not enrolled. Run: weft-worker enrol <token>");
  if (config) for (const line of (await import("../lib/worker-secret-wiring")).keyStatus(home)) console.log(line);
}

// Stop taking secrets from any Mac until the box is paired again (Settings → Devices → Add a worker).
async function forgetMacsCommand() {
  (await import("../lib/worker-secret-wiring")).forgetMacs(home);
  console.log("Forgot the Mac this worker took secrets from. Pair it again from Settings → Devices to use secrets on it.");
}

const [command, arg] = process.argv.slice(2);
const commands: Record<string, () => unknown> = { enrol: () => enrolCommand(arg), login: loginCommand, start: startCommand, status: statusCommand, check: checkCommand, "forget-macs": forgetMacsCommand };
Promise.resolve((commands[command ?? ""] ?? (() => console.log("Usage: weft-worker enrol <token> | login | start | status | restart | update")))()).catch((err: unknown) => {
  const e = err as Error;
  console.error(process.env.WEFT_WORKER_DEBUG ? e.stack : e.message);
  process.exit(1);
});
