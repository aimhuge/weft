// A dev server's vault env on a Weft Worker (docs/architecture/project-hosts.md#the-vault-on-a-worker-t2-as-built).
// On the Mac, devSecrets gets a one-time grant from main and electron/secret-env.cjs claims it. A worker has no main, so
// it asks the owner's Mac with a signed `dev_env` device call (lib/worker-vault.ts askVault): the Mac asks Touch ID at
// every start and restart (no standing grant on a worker), and seals
// the vault's development values to this box as a `secret_use` with `use: "dev"`. The values go to the launcher on its
// stdin (never an env var of the daemon, an argument or a file), the launcher puts them in the server's env only and
// redacts them from its output, and the published dev-server list carries the command and names, never a value.
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DevLaunch } from "./secret-run";
import { ASK_MS, newNonce } from "./secret-use";
import { openAsk } from "./worker-secret-asks";
import { gitRemote, keptAt, remember } from "./worker-secret-run";
import { askVault, vaultLink, type VaultDeps } from "./worker-vault";
import { DEV_ENV } from "./worker-vault-wire";

export interface DevEnvRequest {
  cardId: string;
  thread?: string;
  // The checkout the server runs in: its git remote names the vault, and cwd is said relative to it.
  root: string;
  cwd: string;
  command: string;
  argv: string[];
  env: Record<string, string>;
  script?: string;
}

const RUNNER = () => fileURLToPath(new URL("../electron/secret-env.cjs", import.meta.url));

function within<T>(promise: Promise<T>, ms: number, why: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, fail) => (timer = setTimeout(() => fail(new Error(why)), ms)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** The launch for a worker card's dev server with its vault's development values, or a note for its log. */
export async function devEnvOnWorker(req: DevEnvRequest, given: Partial<VaultDeps> & { waitMs?: number; runner?: string } = {}): Promise<{ launch?: DevLaunch; note?: string }> {
  const nonce = given.nonce?.() ?? newNonce(randomBytes);
  const now = given.now?.() ?? Date.now();
  let ask: ReturnType<typeof openAsk> | undefined;
  try {
    // The vault this checkout names, where a value the Mac kept here is looked up (lib/worker-kept-vault.ts).
    const { repo, kept } = keptAt(given.link === undefined ? vaultLink() : given.link, await (given.remote ?? gitRemote)(req.root), "development");
    ask = openAsk(nonce, { cardId: req.cardId, command: req.command, names: [], environment: "development", expiresAt: now + ASK_MS, dev: true, repo });
    const cwd = path.relative(req.root, req.cwd) || ".";
    const answer = await askVault(req.cardId, req.root, DEV_ENV, { command: req.command, cwd, script: req.script, thread: req.thread, kept }, given, nonce);
    if (answer.denied) return { note: "Started without vault secrets: not approved on your Mac." };
    if (answer.queued !== true) return {};
    const values = await within(ask.values, given.waitMs ?? ASK_MS, "Your Mac approved the dev server's secrets, but they didn't arrive.");
    const names = Object.keys(values);
    remember(req.cardId, values);
    return {
      launch: { bin: process.execPath, args: [given.runner ?? RUNNER()], env: {}, stdin: JSON.stringify({ values, argv: req.argv, env: req.env }), names },
    };
  } catch (err) {
    return { note: `Started without vault secrets: ${(err as Error).message}` };
  } finally {
    ask?.drop();
  }
}
