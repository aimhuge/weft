// Keep Working: the Mac stays awake with the lid shut, so threads keep running in a bag.
//
// Shutting the lid forces sleep whatever caffeinate or powerSaveBlocker say; only `pmset disablesleep 1`
// overrides it. That needs root, so the first use installs a sudoers rule through macOS's own password
// dialog, allowing just `pmset -a disablesleep 0|1`. A detached watchdog puts sleep back at the deadline,
// at 10% battery, or when Weft itself is gone, so a crash can't leave the Mac unable to sleep. "Until
// threads finish" also turns it off once no card has been running for two checks in a row.
// "Always while threads run" (auto) starts "Until threads finish" on its own whenever a card is running;
// it never asks for the password from the background. The battery floor and "Only while online" are the
// watchdog's: a change while on restarts it with the new rules (electron/keep-working-prefs.cjs).
const childProcess = require("node:child_process");
const { dialog } = require("electron");
const { READ_HEADERS } = require("./server-read.cjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { BATTERY_CHOICES, PREFS_FILE, cleanPrefs, readPrefs, writePrefs } = require("./keep-working-prefs.cjs");
const { HOUR_CHOICES, menuTemplate, statusText, sudoersLine, trayTitle } = require("./keep-working-menu.cjs");

const PMSET = "/usr/bin/pmset";
const SUDO = "/usr/bin/sudo";
const SUDOERS = "/etc/sudoers.d/weft-keep-working";
const THREADS_CAP_HOURS = 8;
const CHECK_MS = 60_000;
const IDLE_CHECKS = 2; // a gap between turns isn't the end of the work
const AUTO_CHECK_MS = 15_000;

// Puts sleep back at `until` (seconds), at the battery floor on battery power, when Weft's pid is gone,
// and with online=1 once there's been no default route for two checks in a row (a blip isn't offline).
const WATCHDOG = `
until="$1"; min="$2"; pid="$3"; pmset="$4"; online="$5"; down=0
while [ "$(date +%s)" -lt "$until" ]; do
  sleep 30
  kill -0 "$pid" 2>/dev/null || break
  batt=$(pmset -g batt)
  pct=$(grep -Eo "[0-9]+%" <<<"$batt" | head -1 | tr -d %)
  if grep -q "Battery Power" <<<"$batt" && [ "\${pct:-100}" -le "$min" ]; then break; fi
  if [ "$online" = 1 ]; then
    if /sbin/route -n get default >/dev/null 2>&1; then down=0; else down=$((down + 1)); fi
    [ "$down" -ge 2 ] && break
  fi
done
/usr/bin/sudo -n "$pmset" -a disablesleep 0
`;

function run(proc, file, args) {
  return new Promise((resolve) => proc.execFile(file, args, (err, stdout, stderr) => resolve({ ok: !err, err, out: `${stdout}${stderr}`.trim() })));
}

// How many cards are in Running, or null when the server can't say.
async function countRunning(server) {
  if (!server) return null;
  try {
    const { cards } = await (await fetch(`${server.url}/api/cards`, READ_HEADERS)).json();
    return cards.filter((card) => card.column === "running").length;
  } catch {
    return null;
  }
}

// proc is child_process; tests pass fakes, since vi.mock can't reach this file's require and the real
// one would run sudo pmset on the machine running the tests.
function createKeepWorking({ getServer, onChange, prefsFile = PREFS_FILE, proc = childProcess }) {
  const notify = (message) => dialog.showMessageBox({ type: "warning", message });
  /** @type {{ mode: "off" | "threads" | "hours"; hours?: number; until?: number; running?: number | null }} */
  let state = { mode: "off" };
  let watchdog = null;
  let ticker = null;
  let idle = 0;
  let prefs = readPrefs(prefsFile);
  let autoTimer = null;
  // Turned off by hand while threads run: auto waits until nothing runs before it starts again.
  let snoozed = false;
  // Subscribers fire on every state change; main.cjs forwards them to the board window over IPC
  // (one of the chips changed, the deadline ticked over, the watchdog restored sleep on its own).
  const subscribers = new Set();
  function fanout() {
    onChange();
    for (const cb of subscribers) {
      try { cb(); } catch (err) { console.error("keep-working subscriber:", err); }
    }
  }

  const set = (next) => {
    state = { ...next };
    fanout();
  };

  async function hasRule() {
    return (await run(proc, SUDO, ["-n", "-l", PMSET, "-a", "disablesleep", "1"])).ok;
  }

  // Validates the rule as you, then installs it as root behind macOS's password dialog.
  async function installRule() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-keep-working-"));
    const file = path.join(dir, "rule");
    try {
      fs.writeFileSync(file, sudoersLine(os.userInfo().username));
      const check = await run(proc, "/usr/sbin/visudo", ["-cf", file]);
      if (!check.ok) throw new Error(`The sudoers rule didn't validate: ${check.out}`);
      const script =
        `do shell script "/usr/bin/install -m 0440 -o root -g wheel " & quoted form of "${file}" & " ${SUDOERS}" ` +
        `with administrator privileges with prompt "Weft needs permission, once, to keep your Mac awake with the lid shut."`;
      const res = await run(proc, "/usr/bin/osascript", ["-e", script]);
      if (!res.ok) {
        if (/-128/.test(res.out)) return false; // Cancel
        throw new Error(res.out || "osascript failed");
      }
      return true;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  function killWatchdog() {
    if (watchdog && watchdog.exitCode === null) {
      watchdog.removeAllListeners("exit");
      try {
        process.kill(watchdog.pid);
      } catch {}
    }
    watchdog = null;
  }

  function clearTicker() {
    clearInterval(ticker);
    ticker = null;
  }

  function spawnWatchdog(until) {
    killWatchdog();
    const args = [String(Math.floor(until / 1000)), String(prefs.minBattery), String(process.pid), PMSET, prefs.onlineOnly ? "1" : "0"];
    watchdog = proc.spawn("/bin/bash", ["-c", WATCHDOG, "weft-keep-working", ...args], { detached: true, stdio: "ignore" });
    watchdog.unref();
    watchdog.on("exit", () => {
      watchdog = null;
      clearTicker();
      set({ mode: "off" });
    });
  }

  async function start(mode, hours) {
    try {
      if (!(await hasRule()) && !(await installRule())) return;
      const capHours = mode === "threads" ? THREADS_CAP_HOURS : hours;
      const until = Date.now() + capHours * 3_600_000;
      const res = await run(proc, SUDO, ["-n", PMSET, "-a", "disablesleep", "1"]);
      if (!res.ok) throw new Error(res.out || "pmset failed");

      spawnWatchdog(until);
      idle = 0;
      clearTicker();
      ticker = setInterval(tick, CHECK_MS);
      set({ mode, hours, until, running: null });
      if (mode === "threads") void tick();
    } catch (err) {
      notify(`Keep Working couldn't start: ${err.message || err}`);
    }
  }

  async function tick() {
    if (state.mode === "threads") {
      const running = await countRunning(getServer());
      if (state.mode !== "threads") return;
      idle = running === 0 ? idle + 1 : 0;
      if (idle >= IDLE_CHECKS) return stop();
      set({ ...state, running });
    } else {
      fanout(); // the hours left in the menu bar
    }
  }

  // The watchdog's own rules, checked before auto starts, so it doesn't start only to stop a minute later.
  async function canHold() {
    if (prefs.onlineOnly && !(await run(proc, "/sbin/route", ["-n", "get", "default"])).ok) return false;
    const batt = (await run(proc, PMSET, ["-g", "batt"])).out;
    const pct = Number(/(\d+)%/.exec(batt)?.[1] ?? 100);
    return !(/Battery Power/.test(batt) && pct <= prefs.minBattery);
  }

  // Auto: every check, start "Until threads finish" once a card is running, if the sudoers rule is in.
  async function autoTick() {
    if (!prefs.auto || state.mode !== "off") return;
    const running = await countRunning(getServer());
    if (running === 0) snoozed = false;
    if (!prefs.auto || snoozed || state.mode !== "off" || !running) return;
    if (!(await hasRule()) || !(await canHold())) return;
    await start("threads");
    if (state.mode === "off") snoozed = true; // it failed and said so; don't ask again every check
  }

  function armAuto() {
    clearInterval(autoTimer);
    autoTimer = prefs.auto ? setInterval(() => void autoTick(), AUTO_CHECK_MS) : null;
    if (prefs.auto) void autoTick();
  }

  // A patch of { auto, minBattery, onlineOnly }. Turning auto on installs the sudoers rule first, here,
  // where you asked, so the background check never has to.
  async function setPrefs(patch) {
    const next = cleanPrefs(patch);
    try {
      if (next.auto && !prefs.auto && !(await hasRule()) && !(await installRule())) return;
      const autoChanged = next.auto !== undefined && next.auto !== prefs.auto;
      prefs = { ...prefs, ...next };
      writePrefs(prefsFile, prefs);
      if (autoChanged) {
        snoozed = false;
        armAuto();
      }
      if (state.mode !== "off" && (next.minBattery !== undefined || next.onlineOnly !== undefined)) spawnWatchdog(state.until);
      fanout();
    } catch (err) {
      notify(`Keep Working couldn't change its settings: ${err.message || err}`);
    }
  }

  async function stop({ manual = false } = {}) {
    if (manual && prefs.auto) snoozed = true;
    killWatchdog();
    clearTicker();
    const res = await run(proc, SUDO, ["-n", PMSET, "-a", "disablesleep", "0"]);
    if (!res.ok) notify(`Keep Working couldn't turn sleep back on: ${res.out}. Run: sudo pmset -a disablesleep 0`);
    set({ mode: "off" });
  }

  // On quit: sleep comes back before Weft is gone.
  function stopSync() {
    clearInterval(autoTimer);
    autoTimer = null;
    if (state.mode === "off") return;
    killWatchdog();
    clearTicker();
    try {
      proc.execFileSync(SUDO, ["-n", PMSET, "-a", "disablesleep", "0"], { stdio: "ignore", timeout: 5000 });
    } catch {}
    state = { mode: "off" };
  }

  const handStop = () => stop({ manual: true });
  armAuto();

  return {
    title: () => trayTitle(state, Date.now()),
    menu: () => menuTemplate({ ...state, ...prefs }, Date.now(), { start, stop: handStop, setAuto: (on) => setPrefs({ auto: on }) }),
    start,
    stop: handStop,
    setPrefs,
    // The card in Settings reads this; it mirrors the shape of the internal state and is safe to send
    // over IPC (only primitives, no Electron handles).
    state: () => ({ ...state, ...prefs }),
    // Returns the unsubscribe. main.cjs uses this to forward changes to the board window over IPC.
    subscribe: (cb) => { subscribers.add(cb); return () => subscribers.delete(cb); },
    stopSync,
  };
}

module.exports = { BATTERY_CHOICES, createKeepWorking, HOUR_CHOICES, menuTemplate, statusText, sudoersLine, trayTitle };
