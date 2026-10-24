// Starting Goose with a provider's key in its env, for Weft's own Goose runner (docs/architecture/goose.md).
//
// The key lives in Electron main's Keychain, and the Next server is a different process from main, so the server
// never holds it. It asks main for a one-time grant over the pane's control server and starts electron/goose-env.cjs
// with that grant on stdin; the helper claims it from main and runs Goose with the key in its env.
//
// So the plaintext path is: main's Keychain → electron/goose-env.cjs's env → Goose's env. It never crosses the
// control server, and the board never sees it.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { shell } from "./browser-tools";
import { shellToken } from "./shell-token";

// What main answers a grant request with: the grant itself, how to claim it, and the model the provider serves.
export interface GooseEnvGrant {
  grant: string;
  node: string;
  runner: string;
  model: string;
  names: string[];
}

/**
 * A one-time grant of the env a Goose subprocess needs for this provider, or undefined when the provider has no key
 * saved (or the desktop app isn't running).
 *
 * baseUrl is the endpoint the user picked in Settings; it wins over the copy kept beside the key.
 */
export async function gooseEnvGrant(providerId: string, baseUrl = ""): Promise<GooseEnvGrant | undefined> {
  if (!process.env.WEFT_SHELL_URL) return undefined;
  try {
    const reply = (await shell("/goose/env-grant", { providerId, ...(baseUrl ? { baseUrl } : {}) })) as Partial<GooseEnvGrant>;
    if (typeof reply.grant !== "string" || !reply.grant) return undefined;
    return { grant: reply.grant, node: reply.node ?? "", runner: reply.runner ?? "", model: reply.model ?? "", names: Array.isArray(reply.names) ? reply.names.map(String) : [] };
  } catch {
    // No key saved, or main isn't ready: the caller starts Goose the plain way.
    return undefined;
  }
}

export interface GooseLaunch {
  bin: string;
  args: string[];
  env: Record<string, string>;
  // Read by electron/goose-env.cjs on stdin, so the grant never sits in a process's env.
  stdin: string;
  names: string[];
}

/**
 * How to start Goose with a provider's key in its env: the grant's runner (electron/goose-env.cjs) with the grant on
 * stdin. undefined when there is no key saved for the provider, or the desktop app isn't running.
 */
export async function gooseLaunch(providerId: string, argv: string[], env: Record<string, string> = {}, cwd?: string, baseUrl = ""): Promise<GooseLaunch | undefined> {
  const grant = await gooseEnvGrant(providerId, baseUrl);
  if (!grant || !grant.node || !grant.runner) return undefined;
  return {
    bin: grant.node,
    args: [grant.runner],
    env: { ELECTRON_RUN_AS_NODE: "1" },
    stdin: JSON.stringify({ url: process.env.WEFT_SHELL_URL, token: shellToken(), grant: grant.grant, argv, env, ...(cwd ? { cwd } : {}) }),
    names: grant.names,
  };
}

/**
 * Runs Goose with the provider's key in its env, and gives back its output with the key swapped for ‹NAME›.
 * Returns undefined when there's no key saved for the provider.
 */
export function runGoose(launch: GooseLaunch, argv: string[], options: { cwd?: string; env?: Record<string, string | undefined> } = {}): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    // The env a child process needs is strings only, and a var with no value is no value to a CLI.
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...options.env, ...launch.env })) {
      if (value !== undefined) env[key] = value;
    }
    const child: ChildProcessWithoutNullStreams = spawn(launch.bin, launch.args, {
      cwd: options.cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: "pipe",
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer | string) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer | string) => (out += chunk.toString()));
    child.on("error", () => resolve({ code: null, output: out }));
    child.on("close", (code) => resolve({ code, output: out }));
    child.stdin.on("error", () => {});
    child.stdin.end(launch.stdin);
  });
}
