// A Weft Worker's own files (docs/architecture/weft-worker.md#installing-on-a-box-you-already-have): its home
// (~/.weft-worker, or WEFT_WORKER_HOME), the worker.json enrolment wrote there (mode 600: it holds the key), the
// store it runs cards in (WEFT_DATA, kept apart from a desktop Weft on the same machine) and the work root its
// project checkouts live under (~/.weft-worker/work, or WEFT_WORKER_ROOT).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SealKeys } from "./worker-seal";

export interface WorkerConfig {
  workerId: string;
  orgId: string;
  ownerUser: string;
  // `worker:<id>`, the target_device its commands name.
  device: string;
  // The worker's key (`wwk_…`). Only ever here and in memory.
  key: string;
  name: string;
}

export const workerHome = (env: NodeJS.ProcessEnv = process.env) => env.WEFT_WORKER_HOME || path.join(os.homedir(), ".weft-worker");
export const workerDataDir = (home: string) => path.join(home, "data");
// Inside the worker home, not ~/work: a Mac often has a ~/work of its own, and a run may work in any folder it names.
export const workRoot = (home: string, env: NodeJS.ProcessEnv = process.env) => env.WEFT_WORKER_ROOT || path.join(home, "work");
const configPath = (home: string) => path.join(home, "worker.json");

const isConfig = (v: unknown): v is WorkerConfig => {
  const c = v as Partial<WorkerConfig> | null;
  return !!c && [c.workerId, c.orgId, c.ownerUser, c.device, c.key, c.name].every((s) => typeof s === "string" && s.length > 0);
};

// The enrolled worker, or null before `weft-worker enrol` (or when the file is damaged).
export function readWorkerConfig(home: string): WorkerConfig | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(configPath(home), "utf8"));
    return isConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// worker.env: the variables the service wrapper (install/worker.sh) loads before it starts the daemon, like the
// CLAUDE_CODE_OAUTH_TOKEN `weft-worker login` saves. Mode 600, merged into what's there, one KEY='value' per line.
export function writeWorkerEnv(home: string, vars: Record<string, string>) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = path.join(home, "worker.env");
  const kept = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter((l) => l && !Object.keys(vars).some((k) => l.startsWith(`${k}=`))) : [];
  const lines = [...kept, ...Object.entries(vars).map(([k, v]) => `${k}='${v.replace(/'/g, "")}'`)];
  fs.writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function writeWorkerConfig(home: string, config: WorkerConfig) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = configPath(home);
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync keeps an existing file's mode; a re-enrolment still ends at 600.
  fs.chmodSync(file, 0o600);
}

// seal-key.json: the worker's X25519 keypair (lib/worker-seal.ts), made on first start, mode 600. The public half is
// on its cloud_workers row so the desktop can seal a Claude token to it; the private half never leaves this file.
export function workerSealKeys(home: string, make: () => SealKeys): SealKeys {
  const file = path.join(home, "seal-key.json");
  try {
    const keys = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SealKeys>;
    if (typeof keys.publicKey === "string" && typeof keys.privateKey === "string") return { publicKey: keys.publicKey, privateKey: keys.privateKey };
  } catch {
    // None yet, or damaged: make a fresh pair below.
  }
  const keys = make();
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(keys)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return keys;
}
