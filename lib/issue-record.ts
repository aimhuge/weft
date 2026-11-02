import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store";

// The issues each repo has had a card made for (lib/github-issues.ts, lib/issue-worker.ts), so a card you deleted
// doesn't come back, and a repo synced on this Mac and on a worker makes each card once. Keyed by the repo, lowercased.
const recordFile = () => path.join(DATA_DIR, "github-issues.json");

export function importedIssues(): Record<string, number[]> {
  try {
    return (JSON.parse(fs.readFileSync(recordFile(), "utf8")) as { imported?: Record<string, number[]> }).imported ?? {};
  } catch {
    return {};
  }
}

export function saveImportedIssues(map: Record<string, number[]>) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(recordFile(), JSON.stringify({ imported: map }, null, 2));
}

export const knownIssues = (repo: string) => new Set(importedIssues()[repo.toLowerCase()] ?? []);

export function rememberIssues(repo: string, numbers: number[]) {
  const record = importedIssues();
  const key = repo.toLowerCase();
  record[key] = [...(record[key] ?? []), ...numbers];
  saveImportedIssues(record);
}
