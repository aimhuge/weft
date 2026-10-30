// Server patches: the board's UI and the server's own code, between app versions, without a new .app.
//
// Every hour a packaged Weft reads patch.json from the rolling `patch-latest` GitHub release
// (scripts/server-patch-release.mjs publishes it). A patch whose signature checks out (server-patch-feed.cjs), made
// for this app version and against the same packages, downloads, has its sha256 checked, and is staged beside the app
// (server-patch.cjs). It goes live when the server next starts: on its own once no thread runs and nobody is at the
// Mac (the server restarts and the board reloads, the app itself stays up), on the notification's Restart Now, or on
// the next launch. The full update (updater.cjs) still ships Electron, packages and the toolchain; while one is
// downloading or ready, no patch is fetched. docs/architecture/updates.md#server-patches
const crypto = require("node:crypto");
const { verifyPatch, whyNot } = require("./server-patch-feed.cjs");

const PATCH_FEED = process.env.WEFT_PATCH_FEED || "https://github.com/aimhuge/weft/releases/download/patch-latest/patch.json";
const CHECK_EVERY_MS = 60 * 60 * 1000;
const FIRST_CHECK_MS = 45_000; // after the full update's first check, out of the board's way
const AWAY_SECONDS = 10 * 60;
const QUIET_CHECK_MS = 60_000;

function createPatcher({
  currentVersion,
  packaged,
  publicKey,
  feed = PATCH_FEED,
  fetchJson, // url → the feed, or null when no patch is published
  download, // url → Buffer
  stage, // (details, Buffer) → { build, seq }
  readLocal, // () → { deps, activeSeq, bad }
  countRunning = async () => null,
  idleSeconds = () => 0,
  applyNow = async () => {}, // restarts the server into the staged patch
  restartWhenIdle = async () => {},
  ask = async () => null,
  notify = () => {},
  busy = () => false, // a full update is on its way
  onChange = () => {},
  log = console,
}) {
  let state = { phase: "idle" };
  let timer = null;
  let quietTimer = null;

  function set(next) {
    state = next;
    onChange(state);
  }

  async function check() {
    if (!packaged || !publicKey || busy() || state.phase !== "idle") return state;
    set({ phase: "checking" });
    try {
      const published = await fetchJson(feed);
      if (!published) return done({ phase: "idle", checkedAt: Date.now() });
      const details = verifyPatch(published, publicKey);
      const reason = whyNot(details, { version: currentVersion, ...readLocal() });
      if (reason) return done({ phase: "idle", skipped: details.build, reason, checkedAt: Date.now() });
      set({ phase: "downloading", build: details.build });
      const bytes = await download(details.url);
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      if (bytes.length !== details.size || sha256 !== details.sha256) throw new Error(`server patch ${details.build}: the download doesn't match its feed`);
      const staged = stage(details, bytes);
      done({ phase: "ready", build: staged.build, notes: details.notes || "", checkedAt: Date.now() });
      notify(`Weft ${staged.build} is ready`, "A newer board and server. Weft switches once no thread runs and you've stepped away.", { apply: () => apply() });
      watchForQuiet();
    } catch (err) {
      log.warn?.(`Weft patcher: ${err.message || err}`);
      done({ phase: "idle", error: String(err.message || err), checkedAt: Date.now() });
    }
    return state;
  }

  function done(next) {
    set(next);
    return state;
  }

  // Restarts the server into the staged patch now, or once the running threads finish when you'd rather.
  async function apply() {
    if (state.phase !== "ready") return false;
    const running = await countRunning().catch(() => null);
    if (running > 0) {
      const what = running === 1 ? "1 thread is" : `${running} threads are`;
      const choice = await ask(`${what} still running`, "Switching stops them mid-turn. Switch when they finish, and nothing new starts until then.");
      if (choice === "idle") await restartWhenIdle();
      if (choice !== "now") return false;
    }
    return switchNow();
  }

  async function switchNow() {
    const build = state.build;
    set({ phase: "applying", build });
    try {
      await applyNow();
      set({ phase: "idle", applied: build, checkedAt: Date.now() });
      return true;
    } catch (err) {
      set({ phase: "ready", build, error: String(err.message || err) });
      return false;
    }
  }

  function watchForQuiet() {
    if (quietTimer) return;
    quietTimer = setInterval(() => applyWhenQuiet().catch(() => {}), QUIET_CHECK_MS);
  }

  async function applyWhenQuiet() {
    if (state.phase !== "ready" || idleSeconds() < AWAY_SECONDS) return false;
    const running = await countRunning().catch(() => null);
    if (running !== 0) return false; // a count the server couldn't give is busy, never idle
    return switchNow();
  }

  function start() {
    if (!packaged || !publicKey || timer) return;
    timer = setTimeout(function tick() {
      check().catch(() => {});
      timer = setTimeout(tick, CHECK_EVERY_MS);
    }, FIRST_CHECK_MS);
  }

  function stop() {
    clearTimeout(timer);
    clearInterval(quietTimer);
    timer = null;
    quietTimer = null;
  }

  return { check, apply, applyWhenQuiet, start, stop, state: () => state };
}

module.exports = { createPatcher, PATCH_FEED, CHECK_EVERY_MS, FIRST_CHECK_MS, AWAY_SECONDS, QUIET_CHECK_MS };
