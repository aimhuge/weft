// GitHub on a Weft Worker (docs/architecture/weft-worker.md#cloning-onto-a-worker). A background service can't answer a
// keychain prompt or a password prompt, so the token goes where it reads without one: gh's plain-text hosts.yml, or a
// mode-600 credential file when gh is missing or refuses the token. Either way git is pointed at it for github.com
// alone, so a clone from another host never sees it. The sign-in state always comes from what git would really use.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GITHUB_TOKEN } from "./worker-seal";

export type GithubState = "signed_in" | "expired" | "none";

export interface GithubStatus {
  state: GithubState;
  account: string | null;
}

export type Sh = (cmd: string, args: string[], opts?: { input?: string }) => Promise<string>;
export type Fetcher = (url: string, init: RequestInit) => Promise<Pick<Response, "status" | "json">>;

export interface GithubDeps {
  sh?: Sh;
  fetcher?: Fetcher;
}

const HOST = "github.com";
const HELPER_KEY = `credential.https://${HOST}.helper`;
const SH_TIMEOUT_MS = 30_000;
const API_TIMEOUT_MS = 15_000;
const ACCOUNT_API = `https://api.${HOST}/user`;

// gh won't sign in while it's handed a token in the environment, and git must never stop to ask.
function shEnv() {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return env;
}

export const sh: Sh = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: shEnv(), timeout: SH_TIMEOUT_MS });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
    // A command that's missing, or exits before it reads, closes stdin under us; `error` or `close` reports that.
    child.stdin.on("error", () => {});
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `${cmd} exited with ${String(code)}`))));
    child.stdin.end(opts.input ?? "");
  });

// Who a token belongs to. Null when GitHub can't say (no network, rate limited): that isn't an expired sign-in.
async function whoIs(token: string, fetcher: Fetcher): Promise<GithubStatus | null> {
  try {
    const res = await fetcher(ACCOUNT_API, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "weft-worker" },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (res.status === 401) return { state: "expired", account: null };
    if (res.status !== 200) return null;
    const { login } = (await res.json()) as { login?: unknown };
    return typeof login === "string" ? { state: "signed_in", account: login } : null;
  } catch {
    return null;
  }
}

// The sign-in git would use right now, whoever set it up: the board's, or `gh auth login` by hand on the box.
export async function githubStatus({ sh: run = sh, fetcher = fetch }: GithubDeps = {}): Promise<GithubStatus | null> {
  const out = await run("git", ["credential", "fill"], { input: `protocol=https\nhost=${HOST}\n\n` }).catch(() => "");
  const token = /^password=(.+)$/m.exec(out)?.[1];
  return token ? whoIs(token, fetcher) : { state: "none", account: null };
}

async function signInWithGh(token: string, run: Sh): Promise<boolean> {
  try {
    await run("gh", ["auth", "login", "--hostname", HOST, "--with-token", "--insecure-storage"], { input: `${token}\n` });
    await run("gh", ["auth", "setup-git", "--hostname", HOST]);
    return true;
  } catch {
    return false;
  }
}

async function signInWithFile(file: string, token: string, run: Sh) {
  fs.writeFileSync(file, `https://x-access-token:${token}@${HOST}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  // The empty value clears the helpers set before it, such as macOS's keychain one, which a service can't answer.
  await run("git", ["config", "--global", "--replace-all", HELPER_KEY, ""]);
  await run("git", ["config", "--global", "--add", HELPER_KEY, `store --file="${file}"`]);
}

// Checks the token with GitHub, then signs git in with it. The result says whose it is, for the worker's row.
export async function signInGithub(home: string, token: string, { sh: run = sh, fetcher = fetch }: GithubDeps = {}): Promise<GithubStatus> {
  if (!GITHUB_TOKEN.test(token)) throw new Error("That isn't a GitHub token.");
  const who = await whoIs(token, fetcher);
  if (!who) throw new Error("This worker couldn't reach GitHub to check that token. Try again in a minute.");
  if (who.state !== "signed_in") throw new Error("GitHub refused that token. Make a new one and try again.");
  const file = path.join(home, "github-credentials");
  if (await signInWithGh(token, run)) fs.rmSync(file, { force: true });
  else await signInWithFile(file, token, run);
  return who;
}

const AUTH_FAILURE = /could not read Username|terminal prompts disabled|Authentication failed|Repository not found|Invalid username|returned error: 40[13]|Permission denied|Could not read from remote/i;
const WHERE = "on its row in Settings → Sync → Workers";

// A failed clone as the board should read it: what to do about a sign-in problem, or git's own last word.
export function explainClone(err: unknown, repo: string, status: GithubStatus | null): string {
  const message = err instanceof Error ? err.message : String(err);
  if (AUTH_FAILURE.test(message) && status) {
    if (status.state === "none") return `This worker isn't signed in to GitHub, and ${repo} is private or doesn't exist. Use Sign in to GitHub ${WHERE}.`;
    if (status.state === "expired") return `This worker's GitHub sign-in has expired. Sign in again ${WHERE}.`;
    return `${status.account ?? "This worker's GitHub account"} can't reach ${repo}. Give its token access to that repo, or check the name.`;
  }
  return /fatal: .*/.exec(message)?.[0] ?? message;
}
