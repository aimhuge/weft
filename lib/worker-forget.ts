// `weft-worker forget` (docs/architecture/weft-worker.md#forget-a-worker): the one way to start a box over. It drops
// everything that says who the box is paired with and whom it trusts, and keeps what makes it the same box:
//
//   gone  worker.json (its enrolment and key), mac-keys.json (the Mac it trusts), passkeys.json (what that Mac
//         endorsed), mac-revoked.json (Macs it stopped trusting), kept-vault.json (values a Mac kept here)
//   kept  sign-key.json (how the server knows it's the same box, so its threads come along on the next pairing),
//         seal-key.json, worker.env (its Claude sign-in), work/ and data/ (its checkouts and threads)
//
// Being at the box's terminal is the trust: there's no Mac to approve it. lib/worker-cli-guard.ts keeps threads from
// running weft-worker at all, and forget asks for the box's name typed at a terminal, so a stray paste can't run it.
import fs from "node:fs";
import path from "node:path";
import { KEPT_FILE } from "./worker-mac-keys";

export const FORGOTTEN = ["worker.json", "mac-keys.json", "passkeys.json", "mac-revoked.json", KEPT_FILE] as const;

// Removes the files above; returns the ones that were there.
export function forgetBox(home: string): string[] {
  const gone: string[] = [];
  for (const name of FORGOTTEN) {
    const file = path.join(home, name);
    if (!fs.existsSync(file)) continue;
    fs.rmSync(file, { force: true });
    gone.push(name);
  }
  return gone;
}

// Why forget won't run, or null: only from a terminal, and only once the box's own name is typed back.
export function forgetRefusal(terminal: boolean, name: string, typed: string): string | null {
  if (!terminal) return "weft-worker forget only runs from a terminal on the box: it decides which Mac the box trusts next.";
  if (typed.trim() !== name) return `Not forgotten: type ${name} to confirm.`;
  return null;
}

export function forgetDone(gone: string[]): string {
  const what = gone.length ? `Forgot ${gone.join(", ")}.` : "Nothing to forget: this box wasn't paired.";
  return `${what} Kept sign-key.json and work/, so its threads come back when you pair it.\nNext: Settings → Devices → Add a worker on your Mac, then run here:\n  weft-worker enrol wph.…\n  weft-worker restart`;
}
