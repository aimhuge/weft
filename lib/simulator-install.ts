// Settings → Connectors → Simulators → Install: runs a fix on this Mac instead of handing you a command to copy.
// One job per fix, kept in memory while it runs; the panel polls installJobs() for its last line of output and
// looks again when it ends. The steps themselves are in lib/simulator-install-steps.ts.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { globalSingleton } from "./global-singleton";
import { INSTALL_KEYS, type InstallJob, type InstallKey } from "./simulator-view";

export type OnLine = (line: string) => void;
type StepOpts = { onLine: OnLine; env?: Record<string, string>; input?: string };

// The last line a tool printed: progress bars redraw with \r, so those count as line breaks too.
function lastLine(chunk: string): string | null {
  const lines = chunk.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  return lines.at(-1) ?? null;
}

// One program, no shell, its output fed line by line to onLine. A failure rejects with the last thing it said,
// which names the problem better than an exit code. `input` answers its prompts (licenses, "custom profile?").
export function runStep(file: string, args: string[], { onLine, env, input }: StepOpts): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env: { ...process.env, ...env } });
    let last = "";
    const take = (chunk: Buffer) => {
      const line = lastLine(chunk.toString("utf8"));
      if (!line) return;
      last = line;
      onLine(line);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(last || `${path.basename(file)} exited with ${code}`))));
  });
}

// Fetches a file to disk, refusing it when it isn't the build Weft pinned.
export async function download(url: string, file: string, sha256: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download ${url}: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = crypto.createHash("sha256").update(bytes).digest("hex");
  if (got !== sha256) throw new Error(`${path.basename(url)} isn't the file Weft expected (sha256 ${got}).`);
  fs.writeFileSync(file, bytes);
}

export type Installer = (onLine: OnLine) => Promise<void>;

const jobs = () => globalSingleton("weft-simulator-installs", () => new Map<InstallKey, InstallJob>());

export const isInstallKey = (key: unknown): key is InstallKey => INSTALL_KEYS.includes(key as InstallKey);

export function installJobs(): Partial<Record<InstallKey, InstallJob>> {
  return Object.fromEntries([...jobs()].map(([key, job]) => [key, { ...job }]));
}

// Starts the fix unless it's already running (a second click joins the first).
export function startInstall(key: InstallKey, installers: Record<InstallKey, Installer>): InstallJob {
  const running = jobs().get(key);
  if (running?.status === "running") return { ...running };
  const job: InstallJob = { status: "running", line: "Starting…" };
  jobs().set(key, job);
  installers[key]((line) => {
    job.line = line;
  }).then(
    () => Object.assign(job, { status: "done", line: "Installed" }),
    (err: unknown) => Object.assign(job, { status: "failed", line: err instanceof Error ? err.message : String(err) }),
  );
  return { ...job };
}
