// Writes a release's "What's new" splash (lib/release-splash.ts) into lib/release-splashes.json, in the Copywriter's
// voice: its soul from lib/agents-built-in.json, that version's CHANGELOG.md section as the brief. Run it after the
// version bump's notes commit and before the build, so the update ships its own splash (.claude/skills/release):
//   node scripts/release-splash.mjs <version> [--video /whats-new/<version>.mp4] [--dry-run]
// The writer is puku-cli (puku-ai-2.8) by default; WEFT_SPLASH_CLI=claude runs Claude Code's `claude -p` instead.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { changelogSection } from "./release-feed.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SPLASHES = path.join(ROOT, "lib/release-splashes.json");
const MAX_LINES = 3;
const MAX_CHARS = 110;

export function splashPrompt(soul, version, notes) {
  return [
    soul,
    "",
    `Write the "What's new" splash for Weft ${version}: what someone sees once, the first time Weft opens after it updates itself.`,
    `At most ${MAX_LINES} lines, each under ${MAX_CHARS} characters: the changes they'll notice most, each one with its payoff.`,
    "Pick; don't summarize everything. No plumbing (file names, APIs, refactors, fixes nobody saw), no hype, no emoji.",
    "Answer with only a JSON array of strings, nothing before or after it.",
    "",
    `The release notes for ${version}:`,
    notes,
  ].join("\n");
}

// The lines out of the writer's answer: the first JSON array in it, trimmed, non-empty, at most MAX_LINES.
/** @param {string} answer @returns {string[]} */
export function parseLines(answer) {
  const match = String(answer).match(/\[[\s\S]*\]/);
  if (!match) throw new Error("the writer's answer has no JSON array of lines");
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed)) throw new Error("the writer's answer isn't an array");
  const lines = parsed.filter((l) => typeof l === "string").map((l) => l.trim()).filter(Boolean).slice(0, MAX_LINES);
  if (lines.length === 0) throw new Error("the writer gave no lines");
  return lines;
}

// The splashes file with this version's entry set, newest version first so the file reads as a history.
/**
 * @param {Record<string, { lines: string[], video?: string }>} splashes
 * @param {string} version
 * @param {string[]} lines
 * @param {string} [video]
 * @returns {Record<string, { lines: string[], video?: string }>}
 */
export function withSplash(splashes, version, lines, video) {
  const entry = video ? { lines, video } : { lines };
  const rest = Object.entries(splashes).filter(([v]) => v !== version);
  return Object.fromEntries([[version, entry], ...rest]);
}

/**
 * @param {{ id: string, soul?: string }[]} agents
 * @returns {string}
 */
export function copywriterSoul(agents) {
  const found = agents.find((a) => a.id === "copywriter");
  if (!found?.soul) throw new Error("lib/agents-built-in.json has no copywriter soul");
  return found.soul;
}

function write(prompt) {
  const cli = process.env.WEFT_SPLASH_CLI === "claude" ? ["claude", ["-p", prompt]] : ["puku-cli", ["-p", prompt, "--model", "puku-ai-2.8"]];
  const run = spawnSync(cli[0], cli[1], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`${cli[0]} exited ${run.status}: ${run.stderr.slice(0, 400)}`);
  return run.stdout;
}

function main() {
  const args = process.argv.slice(2);
  const video = args.includes("--video") ? args[args.indexOf("--video") + 1] : undefined;
  const version = args.find((a) => !a.startsWith("--") && a !== video);
  if (!version) {
    console.error("usage: node scripts/release-splash.mjs <version> [--video /whats-new/<version>.mp4] [--dry-run]");
    process.exit(1);
  }
  const notes = changelogSection(fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8"), version);
  if (notes == null) {
    console.error(`release-splash: CHANGELOG.md has no "## [${version}]" section yet. Bump the version first.`);
    process.exit(1);
  }
  const soul = copywriterSoul(JSON.parse(fs.readFileSync(path.join(ROOT, "lib/agents-built-in.json"), "utf8")));
  const lines = parseLines(write(splashPrompt(soul, version, notes)));
  for (const line of lines) console.log(`  ✦ ${line}`);
  if (args.includes("--dry-run")) return;
  const next = withSplash(JSON.parse(fs.readFileSync(SPLASHES, "utf8")), version, lines, video);
  fs.writeFileSync(SPLASHES, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Wrote ${version}'s splash to lib/release-splashes.json`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main();
