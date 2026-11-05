// cloud_cards.repo: each synced card's GitHub repo, so a teammate's desktop board files it under its own checkout
// (lib/team-board.ts; supabase/migrations/20261105065331_cloud_cards_repo.sql). The app ships ahead of its migration, so
// a database without the column yet refuses the row ("Could not find the 'repo' column", PGRST204): the rows go again
// without it, and later flushes leave it out until Weft restarts.
import { globalSingleton } from "./global-singleton";
import { UploadError } from "./cloud-sync-send";

const state = () => globalSingleton("__weftCardsRepo", () => ({ missing: false }));

// Whether an upload failed only because the database has no repo column yet.
export function isMissingRepo(err: unknown): boolean {
  return err instanceof UploadError && err.code === "PGRST204" && /'repo' column/.test(err.message);
}

const withoutRepo = (rows: object[]) => rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== "repo")));

// Puts the card rows with their repo, or without it on a database that hasn't the column.
export async function putWithRepo(put: (rows: object[]) => Promise<void>, rows: object[]): Promise<void> {
  if (state().missing) return put(withoutRepo(rows));
  try {
    await put(rows);
  } catch (err) {
    if (!isMissingRepo(err)) throw err;
    state().missing = true;
    await put(withoutRepo(rows));
  }
}

// For tests: as on a fresh start.
export function forgetMissingRepo(): void {
  state().missing = false;
}
