// tree.snapshot on a Mac (docs/architecture/wip-sync.md#mac-to-mac): another of your Macs asks this one for its
// uncommitted work in a project. A Mac takes no other host-level verb from the network (NO_HOST_VERBS), and this one only
// with a fresh approval signed by a Mac you paired with this one by hand (electron/mac-pins.cjs, checked by main through
// POST /pairing/verify-mac): a Supabase session alone, stolen or not, can't make this Mac push its tree anywhere. The
// approval binds this Mac's id, the project's name and its GitHub repo, a nonce and the time; the project must be one
// switched on in Settings → Sync here, and its origin must be that same repo, so a project that only shares a folder name
// is never pushed. The working tree isn't touched (lib/wip-snapshot.ts), and threads running in it keep running.
import os from "node:os";
import path from "node:path";
import { shell } from "./browser-shell";
import { deviceId } from "./device-id";
import { githubRepoOf } from "./repos";
import { busyCards } from "./runner-state";
import { syncFolders } from "./settings";
import { getCard } from "./store";
import { widenArgsOf, widenChangeOf } from "./widen";
import { widenProblem, type Verified, type WidenDeps } from "./widen-check";
import type { NonceBook } from "./widen-nonces";
import { pushWip, snapshotWip } from "./wip-snapshot";
import type { TreeSnapshotReply } from "./host-api/tree-snapshot";

export const UNSIGNED = "This Mac sends its uncommitted work only when one of your Macs paired with it asks. Pair them in Settings → Devices.";
export const NOT_HERE = "That project isn't switched on in Settings → Sync on that Mac.";
export const OTHER_REPO = "That Mac's project of that name is a different repo.";

export interface MacSnapshotDeps {
  self: () => string;
  name: () => string;
  now: () => number;
  nonces: NonceBook;
  verify: WidenDeps["verify"];
  folders: () => string[];
  repoOf: (folder: string) => string | undefined;
  snapshot: typeof snapshotWip;
  push: typeof pushWip;
  running: (dir: string) => number;
}

// The approvals this Mac ran: main spends each nonce (electron/widen-nonces.cjs), as for every other widening.
const nonces: NonceBook = {
  has: () => false,
  take: async (nonce, _until, issuedAt) => (await shell("/pairing/widen-nonce", { nonce, issuedAt })).ok === true,
};

const inside = (dir: string) => (cwd: string) => cwd === dir || cwd.startsWith(dir + path.sep);

const DEFAULTS: MacSnapshotDeps = {
  self: deviceId,
  name: () => os.hostname().replace(/\.local$/, ""),
  now: Date.now,
  nonces,
  verify: async (body) => (await shell("/pairing/verify-mac", body)) as Verified,
  folders: syncFolders,
  repoOf: githubRepoOf,
  snapshot: snapshotWip,
  push: pushWip,
  running: (dir) => busyCards().filter((id) => inside(dir)(getCard(id)?.cwd ?? "")).length,
};

// The synced folder a project name means here: exactly one, or none.
function folderNamed(name: string, folders: string[]): string | null {
  const named = folders.filter((f) => path.basename(f) === name);
  return named.length === 1 ? (named[0] ?? null) : null;
}

const same = (a: string | undefined, b: string) => Boolean(a) && a?.toLowerCase() === b.toLowerCase();

export async function macSnapshotVerb(args: Record<string, unknown>, deps: MacSnapshotDeps = DEFAULTS): Promise<TreeSnapshotReply> {
  const change = widenChangeOf({ verb: "tree.snapshot", args });
  const wip = change?.wip;
  if (!wip?.folder || !wip.origin) throw new Error("Which project, and which repo?");
  const target = { card: "", verb: "tree.snapshot" as const, change: change as NonNullable<typeof change>, args: widenArgsOf(args) };
  // An approval this Mac signed itself would be the board acting on itself through the network; the pin list never holds it.
  const problem = await widenProblem(target, args.widen, UNSIGNED, { host: deps.self(), now: deps.now(), nonces: deps.nonces, verify: deps.verify });
  if (problem) throw new Error(problem);
  const dir = folderNamed(wip.folder, deps.folders());
  if (!dir) throw new Error(NOT_HERE);
  if (!same(deps.repoOf(dir), wip.origin)) throw new Error(OTHER_REPO);
  const self = deps.self();
  const snap = await deps.snapshot(dir, { device: self, mac: deps.name() });
  await deps.push(dir, self);
  return { ...snap, running: deps.running(dir) };
}
