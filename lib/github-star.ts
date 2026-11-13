import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { STAR_REPO } from "./star-prompt";

// Weft's own repo starred, through the gh CLI you're already signed in to (the "Enjoying Weft?" ask, lib/star-prompt.ts).
// GitHub answers `GET /user/starred/owner/repo` with 204 when you've starred it and 404 when you haven't; gh exits
// non-zero on the 404 and says "HTTP 404". Anything else (no gh, signed out, offline) is "don't know".

type Run = (file: string, args: string[], opts: { timeout: number }) => Promise<unknown>;

const run: Run = promisify(execFile);
const TIMEOUT = 10_000;
const PATH = `user/starred/${STAR_REPO}`;

// true starred, false not yet, null when gh can't tell.
export async function starStatus(exec: Run = run): Promise<boolean | null> {
  try {
    await exec("gh", ["api", PATH], { timeout: TIMEOUT });
    return true;
  } catch (err) {
    const stderr = (err as { stderr?: unknown } | null)?.stderr;
    const said = `${typeof stderr === "string" ? stderr : ""} ${err instanceof Error ? err.message : ""}`;
    return /HTTP 404/.test(said) ? false : null;
  }
}

// Star it; false when gh couldn't (the board then opens the repo's page instead).
export async function starRepo(exec: Run = run): Promise<boolean> {
  try {
    await exec("gh", ["api", "-X", "PUT", PATH], { timeout: TIMEOUT });
    return true;
  } catch {
    return false;
  }
}
