// weft.simLive for the simulator's live view (docs/architecture/simulators.md#live-view): a page in
// <dataDir>/show/simulator/ asks main for the device's window to capture, and sends the user's clicks
// and drags on that video back as taps and swipes.
//
// Why main: desktopCapturer only runs in main, and the taps go to Weft's own server
// (/api/simulator/input), which needs the launch token a `file:` page must never hold. So the page
// asks, main checks it's the pane's own main frame on a simulator viewer page, and main does the rest.

const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { senderOk, isInside } = require("./app-data-frame.cjs");

const INPUT_PATH = "/api/simulator/input";

// "Weft_Pixel_9" and "Weft Pixel 9" are the same device; the emulator titles its window with the AVD name.
const norm = (s) => String(s ?? "").toLowerCase().replace(/[_\s]+/g, " ").trim();

// The Simulator titles a window with the device's name ("iPhone 17 Pro"), the emulator with
// "Android Emulator - Weft_Pixel_9:5554". An exact title wins over one that only contains the name,
// so "iPhone 17" doesn't take "iPhone 17 Pro"'s window.
function pickWindow(sources, deviceName) {
  const want = norm(deviceName);
  if (!want) return null;
  const exact = sources.find((s) => norm(s.name) === want);
  if (exact) return exact;
  const holds = sources.filter((s) => {
    const name = norm(s.name);
    const at = name.indexOf(want);
    // The name must end there or be followed by a separator (":5554", " – iOS 26"), never by more of a longer name.
    return at >= 0 && /^(?:$|\s*[-–—:·(|])/.test(name.slice(at + want.length));
  });
  return holds.sort((a, b) => a.name.length - b.name.length)[0] ?? null;
}

// The page must be one the simulator watch wrote: a file under <dataDir>/show/simulator/.
function onViewerPage(dataDir, event) {
  try {
    const url = event.sender.getURL();
    if (!url.startsWith("file:")) return false;
    return isInside(path.join(dataDir, "show", "simulator"), fileURLToPath(url));
  } catch {
    return false;
  }
}

// What the page asks for: its device's window to capture, or why there isn't one.
async function findSource({ desktopCapturer, systemPreferences }, deviceName) {
  const access = systemPreferences.getMediaAccessStatus?.("screen") ?? "granted";
  // "not-determined" still lists windows: asking for them is what makes macOS prompt.
  if (access === "denied" || access === "restricted") return { ok: false, reason: "permission" };
  const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 } });
  const hit = pickWindow(sources, deviceName);
  if (!hit) return { ok: false, reason: access === "granted" ? "no-window" : "permission" };
  return { ok: true, id: hit.id, name: hit.name };
}

// Only these fields cross to the server, as numbers and short strings; the server checks them again.
function cleanInput(raw) {
  const body = raw && typeof raw === "object" ? raw : {};
  const kind = ["tap", "swipe", "live"].includes(body.kind) ? body.kind : null;
  if (!kind) throw new Error("Unknown input.");
  const out = { kind, device: String(body.device ?? "").slice(0, 120) };
  for (const k of ["x", "y", "x2", "y2", "ms"]) if (typeof body[k] === "number" && Number.isFinite(body[k])) out[k] = body[k];
  return out;
}

async function sendInput({ server, fetch: fetchImpl }, raw) {
  const body = cleanInput(raw);
  const { url, token } = server() ?? {};
  if (!url) return { ok: false, error: "Weft's server isn't running." };
  const res = await fetchImpl(new URL(INPUT_PATH, url), {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-weft-token": token } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, error: data?.error ?? `Weft's server answered ${res.status}.` };
}

// Electron's own modules are looked up when a page asks, so this file loads (and is tested) without Electron.
const electronApis = () => {
  const { desktopCapturer, systemPreferences } = require("electron");
  return { desktopCapturer, systemPreferences };
};

function setupSimLive({ ipcMain, owns, dataDir, server, apis = electronApis, fetch: fetchImpl = globalThis.fetch }) {
  const allowed = (event) => senderOk(owns, event) && onViewerPage(dataDir, event);
  ipcMain.handle("sim-live:source", (event, deviceName) => {
    if (!allowed(event)) throw new Error("Only Weft's simulator view may capture a window.");
    return findSource(apis(), String(deviceName ?? ""));
  });
  ipcMain.handle("sim-live:input", (event, body) => {
    if (!allowed(event)) throw new Error("Only Weft's simulator view may send taps.");
    return sendInput({ server, fetch: fetchImpl }, body);
  });
}

module.exports = { setupSimLive, pickWindow, findSource, cleanInput, sendInput, onViewerPage, INPUT_PATH };
