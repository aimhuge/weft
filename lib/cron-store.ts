import fs from "node:fs";
import path from "node:path";
import { publish } from "./bus";
import { DATA_DIR } from "./store";
import type { Cron } from "./cron-types";

// The crons, kept in ~/.weft/crons.json (lib/crons.ts makes and runs them). Read when used, not at import,
// so tests' WEFT_DATA sandbox applies. Written through a temp file and a rename: the scheduler writes it every
// run, and a half-written file would lose every cron.

const cronsFile = () => path.join(DATA_DIR, "crons.json");

export function listCrons(): Cron[] {
  try {
    return (JSON.parse(fs.readFileSync(cronsFile(), "utf8")) as { crons?: Cron[] }).crons ?? [];
  } catch {
    return [];
  }
}

export function getCron(id: string): Cron | undefined {
  return listCrons().find((c) => c.id === id);
}

function writeCrons(crons: Cron[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${cronsFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ crons }, null, 2));
  fs.renameSync(tmp, cronsFile());
  // The rail's Crons drawer reloads on this.
  publish({ type: "crons" });
}

export function saveCron(cron: Cron): Cron {
  const crons = listCrons();
  const at = crons.findIndex((c) => c.id === cron.id);
  if (at === -1) crons.push(cron);
  else crons[at] = cron;
  writeCrons(crons);
  return cron;
}

export function removeCron(id: string): boolean {
  const crons = listCrons();
  const rest = crons.filter((c) => c.id !== id);
  if (rest.length === crons.length) return false;
  writeCrons(rest);
  return true;
}
