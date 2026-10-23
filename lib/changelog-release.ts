import fs from "node:fs";
import path from "node:path";
import { entriesFor, releaseProject, statusOf, textsFor } from "./changelog";
import { bulletOf, releaseFile } from "./changelog-render";

// Writes a version's section into a project's CHANGELOG.md by hand: `pnpm changelog:release <version>`
// (scripts/changelog-release.ts). Weft normally does this itself when a card's commit bumps package.json's version
// (lib/changelog-write.ts); this is the fallback for a bump it didn't see (a Codex thread, a commit made outside Weft).
// Every unreleased entry goes in, drafts too, plus lines typed under Unreleased.

const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export interface ReleaseResult {
  file: string;
  version: string;
  entries: number;
  // Entries that went out without a commit of their own (still drafts).
  drafts: number;
}

const today = () => new Date().toISOString().slice(0, 10);

export function releaseToFile(project: string, version: string, date = today()): ReleaseResult {
  const v = version.trim().replace(/^v/, "");
  if (!VERSION.test(v)) throw new Error(`"${version}" isn't a version like 1.2.3.`);
  const file = path.join(project, "CHANGELOG.md");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (text && new RegExp(`^## \\[${v.replace(/[.+]/g, "\\$&")}\\]`, "m").test(text)) throw new Error(`CHANGELOG.md already has ${v}.`);
  const pending = entriesFor(project).filter((e) => !e.version);
  // The file first: if it can't be written, nothing is marked released.
  fs.writeFileSync(file, releaseFile(text, v, date, pending, new Set([...textsFor(project)].map(bulletOf))));
  releaseProject(project, v);
  return { file, version: v, entries: pending.length, drafts: pending.filter((e) => statusOf(e) === "draft").length };
}
