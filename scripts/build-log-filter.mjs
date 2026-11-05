#!/usr/bin/env node
// Pipe electron-builder's output through this to hide the known-harmless lines listed in
// scripts/build-log-ignore.json; everything else passes through untouched. Ends with one line
// saying how many it hid, so a quiet log never looks like a clean one by accident.
//
//   electron-builder ... 2>&1 | node scripts/build-log-filter.mjs
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const RULES_PATH = fileURLToPath(new URL("./build-log-ignore.json", import.meta.url));

/** The dependency ids on an electron-builder summary line: `dependencies=["a@1","b@2"]`. */
export function depsOf(line) {
  const m = line.match(/dependencies=(\[.*\])/);
  if (!m) return [];
  try {
    return JSON.parse(m[1]);
  } catch {
    return [];
  }
}

/** The rule that hides this line, or undefined to keep it. */
export function hiddenBy(line, rules) {
  return rules.find((rule) => {
    if (!line.includes(`• ${rule.message} `)) return false;
    if (!rule.every_dep) return true;
    const deps = depsOf(line);
    const pattern = new RegExp(rule.every_dep);
    return deps.length > 0 && deps.every((d) => pattern.test(d));
  });
}

export function loadRules(path = RULES_PATH) {
  return JSON.parse(readFileSync(path, "utf8")).rules;
}

async function main() {
  const rules = loadRules();
  const hidden = new Map();
  for await (const line of createInterface({ input: process.stdin })) {
    const rule = hiddenBy(line, rules);
    if (rule) hidden.set(rule.message, (hidden.get(rule.message) ?? 0) + 1);
    else process.stdout.write(`${line}\n`);
  }
  if (hidden.size) {
    const names = [...hidden.keys()].map((m) => `"${m}"`).join(", ");
    process.stdout.write(`  • hid known-harmless lines: ${names} (scripts/build-log-ignore.json)\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
