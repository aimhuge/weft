import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { DATA_DIR } from "./store";

// cloudflared, the program that holds a quick tunnel open (docs/architecture/tunnels.md). Weft fetches one pinned
// release into ~/.weft/bin on first use and checks it against GitHub's published digest, so it never runs a binary it
// can't vouch for. To move to a new release, change VERSION and the digests together.

export const VERSION = "2026.10.6";
const RELEASES = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}`;
export const ASSETS: Record<string, { file: string; sha256: string }> = {
  "darwin-arm64": { file: "cloudflared-darwin-arm64.tgz", sha256: "ea1e5105d35bbe16cee5b2f7b4742059ada341fbd35938ed827c24b85efa51c8" },
  "darwin-x64": { file: "cloudflared-darwin-amd64.tgz", sha256: "6c04a13835ca5ff29a0c6f58d17d1f3956aad1b7df1631f5b5efbc06269deded" },
  "linux-arm64": { file: "cloudflared-linux-arm64", sha256: "0ae0e179475b2c77651a718d2b376e0151f4fca5954702a84f02843a4d5fcac0" },
  "linux-x64": { file: "cloudflared-linux-amd64", sha256: "1d356dac769d0dbf62ebe588c4034824bbff98d5790c2f844cc99e0e2f57462d" },
};

export const URL_TIMEOUT_MS = 30_000;
const QUICK_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

const binPath = () => path.join(DATA_DIR, "bin", `cloudflared-${VERSION}`);
const run = promisify(execFile);

// Unpacks the release into place. A tarball holds one file called cloudflared; a Linux release is the program itself.
async function install(bytes: Buffer, file: string, target: string) {
  const dir = fs.mkdtempSync(`${target}.`);
  try {
    const fetched = path.join(dir, file);
    fs.writeFileSync(fetched, bytes);
    if (file.endsWith(".tgz")) await run("tar", ["-xzf", fetched, "-C", dir, "cloudflared"]);
    const program = file.endsWith(".tgz") ? path.join(dir, "cloudflared") : fetched;
    fs.chmodSync(program, 0o755);
    fs.renameSync(program, target);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The checked program's path, fetching it the first time.
export async function ensureCloudflared(platform = `${process.platform}-${process.arch}`, get: typeof fetch = fetch): Promise<string> {
  const target = binPath();
  if (fs.existsSync(target)) return target;
  const asset = ASSETS[platform];
  if (!asset) throw new Error(`Tunnels don't run on ${platform} yet.`);
  const res = await get(`${RELEASES}/${asset.file}`);
  if (!res.ok) throw new Error(`Couldn't fetch cloudflared: ${res.status}.`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("The cloudflared download failed its checksum, so Weft didn't run it.");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await install(bytes, asset.file, target);
  return target;
}

export interface QuickTunnel {
  url: string;
  stop: () => void;
}

// Starts a quick tunnel to a local port and answers with its URL. onExit fires if it ends on its own, not on stop().
export function startQuickTunnel(bin: string, port: number, onExit: () => void, launch: typeof spawn = spawn, timeoutMs = URL_TIMEOUT_MS): Promise<QuickTunnel> {
  // An empty config, because a named tunnel's ~/.cloudflared/config.yml would otherwise take over a quick one.
  const child: ChildProcess = launch(bin, ["tunnel", "--no-autoupdate", "--config", "/dev/null", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  let stopped = false;
  const stop = () => {
    stopped = true;
    child.kill();
  };
  // It would outlive this server otherwise, holding a tunnel open to a gate that's gone.
  process.once("exit", stop);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error("cloudflared didn't give a URL in time."));
    }, timeoutMs);
    let found = false;
    const read = (chunk: Buffer) => {
      const url = QUICK_URL.exec(String(chunk))?.[0];
      if (!url || found) return;
      found = true;
      clearTimeout(timer);
      resolve({ url, stop });
    };
    child.stderr?.on("data", read);
    child.stdout?.on("data", read);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", () => {
      process.off("exit", stop);
      clearTimeout(timer);
      if (!found) reject(new Error("cloudflared stopped before it gave a URL."));
      else if (!stopped) onExit();
    });
  });
}
