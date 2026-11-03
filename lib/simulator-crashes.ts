// What `logs` can't see in Local Simulator mode: when an iOS simulator app crashes the report lands on the Mac, in
// ~/Library/Logs/DiagnosticReports, not in the device's log. Those reports cover every process on the Mac, so only a report
// whose path names this device goes back to a worker, and only what explains the crash: never a whole report.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adb } from "./simulator-devices";
import type { Device } from "./simulator-devices";

const WINDOW_MS = 15 * 60_000;
const MAX_REPORTS = 3;
const FRAMES = 12;

interface Ips {
  procName?: string;
  exception?: { type?: string; signal?: string };
  termination?: { indicator?: string };
  faultingThread?: number;
  threads?: { frames?: { symbol?: string; imageIndex?: number }[] }[];
  usedImages?: { name?: string }[];
}

// A .ips file is a line of JSON and then the report as JSON.
export function crashSummary(raw: string, deviceId: string): string | null {
  if (!raw.includes(`CoreSimulator/Devices/${deviceId}`)) return null;
  const split = raw.indexOf("\n");
  let ips: Ips;
  try {
    ips = JSON.parse(raw.slice(split + 1)) as Ips;
  } catch {
    return null;
  }
  const frames = (ips.threads?.[ips.faultingThread ?? 0]?.frames ?? []).slice(0, FRAMES);
  const stack = frames.map((f, i) => `  ${i} ${ips.usedImages?.[f.imageIndex ?? -1]?.name ?? "?"} ${f.symbol ?? "?"}`);
  return [`${ips.procName ?? "app"}: ${ips.exception?.type ?? "crash"} ${ips.exception?.signal ?? ""}`.trim(), ips.termination?.indicator, ...stack].filter(Boolean).join("\n");
}

export async function recentCrashes(d: Device, app: string | undefined, now = Date.now(), dir = path.join(os.homedir(), "Library/Logs/DiagnosticReports")): Promise<string> {
  if (d.platform === "android") return (await adb(d, ["logcat", "-d", "-b", "crash", "-t", "60"]).catch(() => Buffer.from(""))).toString().trim();
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) return "";
  const fresh = fs
    .readdirSync(/*turbopackIgnore: true*/ dir)
    .filter((n) => n.endsWith(".ips") && (!app || n.startsWith(app)))
    .map((n) => ({ file: path.join(dir, n), at: fs.statSync(path.join(dir, n)).mtimeMs }))
    .filter((r) => now - r.at < WINDOW_MS)
    .sort((a, b) => b.at - a.at);
  const out: string[] = [];
  for (const { file } of fresh) {
    if (out.length === MAX_REPORTS) break;
    const summary = crashSummary(fs.readFileSync(file, "utf8"), d.id);
    if (summary) out.push(summary);
  }
  return out.join("\n\n");
}
