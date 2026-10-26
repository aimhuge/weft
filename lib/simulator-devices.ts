// The devices a thread can drive and what it does with a whole device: list, boot, install, launch, open a URL,
// screenshot and logs. iOS goes through `xcrun simctl`, Android through adb (and the emulator to boot an AVD).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bins, binPath, run, runText, shellQuote, sleep } from "./simulator-exec";

export type Platform = "ios" | "android";
export type Device = { id: string; name: string; platform: Platform; state: "booted" | "shutdown" | "booting"; runtime?: string };

// How long a boot may take before the tool gives up (an emulator's first cold boot is the slow one).
export const BOOT_MS = 180_000;
const BOOT_POLL_MS = 2_000;
// An AVD that isn't running has no adb serial yet, so it goes by its name.
const AVD = "avd:";

type SimctlDevices = { devices: Record<string, Array<{ udid: string; name: string; state: string; isAvailable?: boolean }>> };

// "com.apple.CoreSimulator.SimRuntime.iOS-18-2" → "iOS 18.2".
export function runtimeName(id: string) {
  const [os_, ...version] = id.replace(/^.*\./, "").split("-");
  return version.length ? `${os_} ${version.join(".")}` : os_;
}

export function parseSimctl(json: string): Device[] {
  const { devices } = JSON.parse(json) as SimctlDevices;
  return Object.entries(devices).flatMap(([runtime, list]) =>
    list
      .filter((d) => d.isAvailable !== false)
      .map((d): Device => ({ id: d.udid, name: d.name, platform: "ios", state: stateOf(d.state), runtime: runtimeName(runtime) })),
  );
}

function stateOf(state: string): Device["state"] {
  if (state === "Booted") return "booted";
  return state === "Booting" ? "booting" : "shutdown";
}

// `adb devices` lines that are ready ("emulator-5554\tdevice"); offline and unauthorized ones can't be driven.
export function parseAdbDevices(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .flatMap(([serial, state]) => (serial && state === "device" ? [serial] : []));
}

async function iosDevices(): Promise<Device[]> {
  if (!bins().xcrun) return [];
  try {
    return parseSimctl(await runText("xcrun", ["simctl", "list", "devices", "available", "-j"]));
  } catch {
    // Xcode without a selected developer dir, or only the command-line tools: no simulators to list.
    return [];
  }
}

// The AVD an emulator runs, so a running one and its AVD in the list are the same device.
async function avdOf(serial: string) {
  if (!serial.startsWith("emulator-")) return serial;
  try {
    return (await runText("adb", ["-s", serial, "emu", "avd", "name"])).replace(/\n[\s\S]*/, "").trim() || serial;
  } catch {
    return serial;
  }
}

async function androidDevices(): Promise<Device[]> {
  const { adb, emulator } = bins();
  const running = adb ? await Promise.all(parseAdbDevices(await runText("adb", ["devices"]).catch(() => "")).map(async (id) => ({ id, name: await avdOf(id) }))) : [];
  const avds = emulator ? (await runText("emulator", ["-list-avds"]).catch(() => "")).split("\n").map((l) => l.trim()).filter((l) => l && !l.includes(" ")) : [];
  const names = new Set(running.map((d) => d.name));
  return [
    ...running.map((d): Device => ({ ...d, platform: "android", state: "booted" })),
    ...avds.filter((name) => !names.has(name)).map((name): Device => ({ id: `${AVD}${name}`, name, platform: "android", state: "shutdown" })),
  ];
}

export async function listDevices(): Promise<Device[]> {
  const [ios, android] = await Promise.all([iosDevices(), androidDevices()]);
  return [...ios, ...android];
}

// A device by its id (udid, adb serial, avd:name) or its name; with none named, the one booted device.
export function pickDevice(devices: Device[], query?: string): Device {
  const q = query?.trim().toLowerCase();
  if (!q) {
    const booted = devices.filter((d) => d.state === "booted");
    const [only, ...more] = booted;
    if (only && !more.length) return only;
    throw new Error(booted.length ? `${booted.length} devices are booted; name one: ${booted.map((d) => d.id).join(", ")}` : "No device is booted. Boot one with mcp__simulator__boot.");
  }
  const found =
    devices.find((d) => d.id.toLowerCase() === q) ??
    devices.find((d) => d.name.toLowerCase() === q && d.state === "booted") ??
    devices.find((d) => d.name.toLowerCase() === q) ??
    devices.find((d) => d.id.toLowerCase() === `${AVD}${q}`);
  if (!found) throw new Error(`No device matches ${query}. mcp__simulator__list_devices names them.`);
  return found;
}

export async function device(query?: string) {
  return pickDevice(await listDevices(), query);
}

// A booted device, so tools that need one say so plainly instead of failing inside simctl or adb.
export async function bootedDevice(query?: string) {
  const d = await device(query);
  if (d.state !== "booted") throw new Error(`${d.name} isn't booted. Boot it with mcp__simulator__boot.`);
  return d;
}

const adb = (d: Device, args: string[], opts?: { timeout?: number }) => run("adb", ["-s", d.id, ...args], opts);

async function bootIos(d: Device) {
  await run("xcrun", ["simctl", "boot", d.id]).catch((err: unknown) => {
    if (!(err instanceof Error && /current state: Booted/i.test(err.message))) throw err;
  });
  // Simulator.app shows it, so the user can watch it and click in it too.
  await run("xcrun", ["simctl", "bootstatus", d.id, "-b"], { timeout: BOOT_MS });
  await new Promise<void>((resolve) => spawn("/usr/bin/open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", d.id], { stdio: "ignore" }).on("close", () => resolve()).on("error", () => resolve()));
}

async function bootAndroid(d: Device, now = Date.now) {
  const name = d.id.slice(AVD.length);
  spawn(binPath("emulator"), ["-avd", name], { detached: true, stdio: "ignore" }).unref();
  const until = now() + BOOT_MS;
  while (now() < until) {
    await sleep(BOOT_POLL_MS);
    const up = (await androidDevices()).find((x) => x.name === name && x.state === "booted");
    if (up && (await adb(up, ["shell", "getprop", "sys.boot_completed"]).catch(() => Buffer.from(""))).toString().trim() === "1") return up;
  }
  throw new Error(`${name} didn't finish booting in ${BOOT_MS / 1000}s.`);
}

export async function boot(query?: string, now = Date.now): Promise<Device> {
  const d = await device(query);
  if (d.state === "booted") return d;
  if (d.platform === "ios") {
    await bootIos(d);
    return { ...d, state: "booted" };
  }
  return bootAndroid(d, now);
}

export async function install(d: Device, file: string) {
  if (!path.isAbsolute(file) || !fs.existsSync(file)) throw new Error(`No app at ${file}; give the absolute path of a built .app (iOS) or .apk (Android).`);
  if (d.platform === "ios") await run("xcrun", ["simctl", "install", d.id, file]);
  else await adb(d, ["install", "-r", file]);
}

export async function launch(d: Device, app: string) {
  if (d.platform === "ios") return (await runText("xcrun", ["simctl", "launch", d.id, app])).trim();
  return (await adb(d, ["shell", "monkey", "-p", shellQuote(app), "-c", "android.intent.category.LAUNCHER", "1"])).toString().trim();
}

const LOCAL = /^(localhost|127\.0\.0\.1)$/;

// A deep link or a web page. The iOS simulator shares the Mac's network, so localhost works as is; an Android
// emulator's localhost is itself, so a local dev server's port is reversed to the Mac's first.
export async function openUrl(d: Device, url: string) {
  if (d.platform === "ios") {
    await run("xcrun", ["simctl", "openurl", d.id, url]);
    return;
  }
  const u = URL.canParse(url) ? new URL(url) : undefined;
  if (u && LOCAL.test(u.hostname)) {
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    await adb(d, ["reverse", `tcp:${port}`, `tcp:${port}`]);
  }
  await adb(d, ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", shellQuote(url)]);
}

// The screen as PNG bytes.
export async function screenshot(d: Device): Promise<Buffer> {
  if (d.platform === "android") return adb(d, ["exec-out", "screencap", "-p"]);
  const file = path.join(os.tmpdir(), `weft-sim-${d.id}-${process.hrtime.bigint()}.png`);
  try {
    await run("xcrun", ["simctl", "io", d.id, "screenshot", "--type=png", file]);
    return fs.readFileSync(file);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

export const MAX_LOG_LINES = 400;

// The newest log lines, optionally for one app (its process name on iOS, its package on Android).
export async function logs(d: Device, { app, lines = 100, since = "2m" }: { app?: string; lines?: number; since?: string } = {}) {
  const count = Math.max(1, Math.min(MAX_LOG_LINES, Math.round(lines)));
  if (d.platform === "ios") {
    const filter = app ? ["--predicate", `process == ${JSON.stringify(app)} OR subsystem BEGINSWITH ${JSON.stringify(app)}`] : [];
    const out = await runText("xcrun", ["simctl", "spawn", d.id, "log", "show", "--last", since, "--style", "compact", ...filter]);
    return out.trimEnd().split("\n").slice(-count).join("\n");
  }
  const pid = app ? (await adb(d, ["shell", "pidof", shellQuote(app)]).catch(() => Buffer.from(""))).toString().trim().split(/\s+/)[0] : "";
  if (app && !pid) throw new Error(`${app} isn't running on ${d.name}; launch it first.`);
  return (await adb(d, ["logcat", "-d", "-t", String(count), ...(pid ? [`--pid=${pid}`] : [])])).toString().trimEnd();
}
