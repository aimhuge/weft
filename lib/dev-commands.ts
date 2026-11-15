import fs from "node:fs";
import path from "node:path";
import type { DevCommand } from "./types";

// The Services drawer's Dev servers section: how a folder starts its dev server, read from the files
// that say so (package.json scripts run with the lockfile's package manager, a Procfile's web line,
// Rails, Django, deno tasks, a Makefile target, wrangler). Nothing runs here; it only reads.

// At most this many commands a folder: the drawer is narrow.
export const MAX_COMMANDS = 3;

// Script names that start a server, best first.
const SCRIPT_ORDER = ["dev", "start", "serve", "develop", "preview", "storybook"];
// A script by another name that still runs one ("web": "next dev").
export const SERVER_RE = /\b(next dev|vite(?:\s+(?:dev|serve)\b|\s+--|\s*$)|astro dev|nuxt dev|remix (?:vite:)?dev|wrangler dev|webpack(?:-dev-server| serve)|react-scripts start|gatsby develop|ng serve|expo start|vercel dev|hugo server|eleventy --serve|storybook dev|nodemon|tsx watch)/;

// A framework's own port when the script doesn't name one, first match wins.
const DEFAULT_PORTS: [RegExp, number][] = [
  [/\bvite preview\b/, 4173],
  [/\bremix dev\b/, 3000],
  [/\b(vite|remix vite:dev|svelte-kit)\b/, 5173],
  [/\bastro\b/, 4321],
  [/\bwrangler\b/, 8787],
  [/\bstorybook\b/, 6006],
  [/\bng serve\b/, 4200],
  [/\bgatsby\b/, 8000],
  [/\bexpo\b/, 8081],
  [/\bhugo\b/, 1313],
  [/\beleventy\b/, 8080],
  [/\b(next|nuxt|react-scripts|vercel dev|rails|bin\/dev)\b/, 3000],
  [/\bmanage\.py runserver\b/, 8000],
];

// "-p 4001", "--port 4001", "--port=4001", "PORT=4001": the port the script names.
export function namedPort(body: string): number | undefined {
  const m = /(?:^|\s)(?:-p|--port)[\s=](\d{2,5})\b|\bPORT=(\d{2,5})\b/.exec(body);
  const port = m?.[1] ?? m?.[2];
  return port ? Number(port) : undefined;
}

// The url a command will answer on, or undefined when nothing hints at one.
export function guessUrl(body: string): string | undefined {
  const port = namedPort(body) ?? DEFAULT_PORTS.find(([re]) => re.test(body))?.[1];
  if (!port) return undefined;
  const host = /(?:-H|--host(?:name)?)[\s=]127\.0\.0\.1\b/.test(body) ? "127.0.0.1" : "localhost";
  return `http://${host}:${port}`;
}

function read(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

const has = (folder: string, name: string) => fs.existsSync(path.join(folder, name));

// "sh scripts/dev.sh", "node scripts/dev.mjs": the start of the file the script hands off to, so its
// PORT=4002 or `next dev` can name the url when the script itself doesn't.
export function scriptFile(folder: string, body: string): string | undefined {
  const file = /(?:^|\s)(?:(?:sh|bash|zsh|node)\s+)?(\.{0,2}\/?[\w./-]+\.(?:sh|mjs|cjs|js))(?=\s|$)/.exec(body)?.[1];
  return file ? read(path.join(folder, file))?.slice(0, 4096) : undefined;
}

// "pnpm dev", "yarn dev", "bun run dev", "npm run dev": the folder's own package manager, from
// package.json's packageManager field, else its lockfile.
export function runScript(folder: string, pkg: { packageManager?: unknown }, name: string): string {
  const declared = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : "";
  const manager = declared || (has(folder, "pnpm-lock.yaml") ? "pnpm" : has(folder, "yarn.lock") ? "yarn" : has(folder, "bun.lockb") || has(folder, "bun.lock") ? "bun" : "npm");
  if (manager === "pnpm" || manager === "yarn") return `${manager} ${name}`;
  return `${manager} run ${name}`;
}

function rank(name: string): number {
  const i = SCRIPT_ORDER.indexOf(name);
  return i === -1 ? SCRIPT_ORDER.length : i;
}

function fromPackageJson(folder: string): DevCommand[] {
  const text = read(path.join(folder, "package.json"));
  if (!text) return [];
  let pkg: { scripts?: Record<string, unknown>; packageManager?: unknown };
  try {
    pkg = JSON.parse(text) as typeof pkg;
  } catch {
    return [];
  }
  const scripts = Object.entries(pkg.scripts ?? {}).filter((e): e is [string, string] => typeof e[1] === "string");
  return scripts
    .filter(([name, body]) => SCRIPT_ORDER.includes(name) || SERVER_RE.test(body))
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([name, body]) => {
      const url = guessUrl(body) ?? guessUrl(scriptFile(folder, body) ?? "");
      return { command: runScript(folder, pkg, name), label: name, ...(url && { url }) };
    });
}

// A Procfile's `web:` line, run as written.
function fromProcfile(folder: string): DevCommand[] {
  const web = read(path.join(folder, "Procfile"))?.split("\n").find((l) => l.startsWith("web:"));
  const command = web?.slice(4).trim();
  if (!command) return [];
  const url = guessUrl(command);
  return [{ command, label: "Procfile web", ...(url && { url }) }];
}

// Rails (bin/dev runs its Procfile.dev, else the server), Django (with the folder's venv when there is one).
function fromFrameworks(folder: string): DevCommand[] {
  if (has(folder, "bin/dev")) return [{ command: "bin/dev", label: "bin/dev", url: "http://localhost:3000" }];
  if (has(folder, "bin/rails")) return [{ command: "bin/rails server", label: "Rails", url: "http://localhost:3000" }];
  if (has(folder, "manage.py")) {
    const python = has(folder, ".venv/bin/python") ? ".venv/bin/python" : "python3";
    return [{ command: `${python} manage.py runserver`, label: "manage.py", url: "http://localhost:8000" }];
  }
  return [];
}

// deno.json(c) tasks named dev or start.
function fromDeno(folder: string): DevCommand[] {
  const text = read(path.join(folder, "deno.json")) ?? read(path.join(folder, "deno.jsonc"));
  if (!text) return [];
  return ["dev", "start"]
    .map((name) => ({ name, body: new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`).exec(text)?.[1] }))
    .filter((t): t is { name: string; body: string } => t.body !== undefined)
    .map(({ name, body }) => {
      const url = guessUrl(body);
      return { command: `deno task ${name}`, label: `deno ${name}`, ...(url && { url }) };
    });
}

// A Makefile's dev, run, serve or start target.
function fromMakefile(folder: string): DevCommand[] {
  const text = read(path.join(folder, "Makefile"));
  if (!text) return [];
  const target = ["dev", "run", "serve", "start"].find((t) => new RegExp(`^${t}:`, "m").test(text));
  return target ? [{ command: `make ${target}`, label: `make ${target}` }] : [];
}

// A Worker with no script of its own.
function fromWrangler(folder: string): DevCommand[] {
  const config = ["wrangler.toml", "wrangler.json", "wrangler.jsonc"].some((f) => has(folder, f));
  return config ? [{ command: "npx wrangler dev", label: "wrangler", url: "http://localhost:8787" }] : [];
}

// Every way the folder starts a dev server, best first, one per command, at most MAX_COMMANDS.
export function detectDevCommands(folder: string): DevCommand[] {
  const fromPackage = fromPackageJson(folder);
  const found = [...fromPackage, ...fromProcfile(folder), ...fromFrameworks(folder), ...fromDeno(folder), ...fromMakefile(folder), ...(fromPackage.length ? [] : fromWrangler(folder))];
  const seen = new Set<string>();
  return found.filter((c) => !seen.has(c.command) && seen.add(c.command)).slice(0, MAX_COMMANDS);
}
