// What a synced folder sends and takes (docs/architecture/folder-sync.md), with no I/O: the peer
// (lib/tree-sync-peer.ts) reads the folder, asks here, and writes what it's told.
//
// For each path it keeps a base: the state this end last knew the other end to have. A path whose state moved off its
// base changed here and goes out; a change coming in names the base it moved from, so this end can tell a plain update
// (its own file still sits on that base) from a clash (both ends changed it). A clash goes to whichever end wins (more
// threads running there, then the higher id): the winner keeps its file and sends it back marked `conflict`, the loser
// keeps its own version as a copy beside the file and takes the winner's. Nothing is lost either way.
import type { FileState, Files } from "./tree-sync-protocol";

export interface Outgoing {
  path: string;
  state: FileState;
  base: FileState;
  conflict?: true;
}

export type Decision =
  // Already there: nothing to write.
  | { kind: "same" }
  // Write the incoming state; first copy this end's own file aside when `keepCopy`.
  | { kind: "take"; keepCopy: boolean }
  // This end won the clash: keep its file and send it back.
  | { kind: "keep"; reply: Outgoing };

const HEAD: FileState = "HEAD";
// A state with bytes behind it that HEAD doesn't hold: the only kind worth a copy.
const hasBytes = (s: FileState) => s !== null && s !== HEAD;
// A path's state in a hello: absent means HEAD, and null (deleted) stays null.
const stateIn = (files: Files, p: string): FileState => (Object.hasOwn(files, p) ? (files[p] as FileState) : HEAD);

export function createEngine(win: () => boolean, saved: Files = {}) {
  const base = new Map<string, FileState>(Object.entries(saved));
  const baseOf = (p: string) => (base.has(p) ? (base.get(p) as FileState) : HEAD);
  const set = (p: string, s: FileState) => (s === HEAD ? base.delete(p) : base.set(p, s));

  return {
    baseOf,
    // What to keep across lines (lib/tree-sync-peer.ts saves it in .git): every path whose base isn't HEAD.
    saved: (): Files => Object.fromEntries(base),
    forget: () => base.clear(),

    // Both ends' hellos, side by side: what this end sends now. The other end runs the same with the roles swapped,
    // so each path moves exactly one way, or both ways once over a clash (the winner's copy ends it).
    start(mine: Files, theirs: Files): Outgoing[] {
      const out: Outgoing[] = [];
      for (const p of new Set([...Object.keys(mine), ...Object.keys(theirs), ...base.keys()])) {
        const m = stateIn(mine, p);
        const t = stateIn(theirs, p);
        const b = baseOf(p);
        if (m === t) set(p, m);
        // They haven't moved since we last agreed: ours goes.
        else if (t === b) out.push({ path: p, state: m, base: t });
        // We haven't moved: theirs is coming.
        else if (m === b) continue;
        // Both moved: the winner sends, flagged, and the loser keeps a copy when it lands.
        else if (win()) out.push({ path: p, state: m, base: t, conflict: true });
      }
      for (const o of out) set(o.path, o.state);
      return out;
    },

    // A path changed here (the watcher saw it): the change to send, or null when the other end has it already.
    local(path: string, now: FileState): Outgoing | null {
      const b = baseOf(path);
      if (now === b) return null;
      set(path, now);
      return { path, state: now, base: b };
    },

    // A change came in; `current` is this end's state of that path, read just now.
    remote(change: Outgoing, current: FileState): Decision {
      const { path, state } = change;
      if (current === state) {
        set(path, state);
        return { kind: "same" };
      }
      // Untouched here since the base it names, so a plain update, unless it ends a clash the sender won.
      if (current === change.base) {
        set(path, state);
        return { kind: "take", keepCopy: Boolean(change.conflict) && hasBytes(current) };
      }
      if (win()) {
        set(path, current);
        return { kind: "keep", reply: { path, state: current, base: state, conflict: true } };
      }
      set(path, state);
      return { kind: "take", keepCopy: hasBytes(current) };
    },
  };
}

export type Engine = ReturnType<typeof createEngine>;

// Who wins a clash: more priority, then the higher id, so both ends agree without asking.
export const wins = (mine: { prio: number; id: string }, theirs: { prio: number; id: string }) =>
  mine.prio !== theirs.prio ? mine.prio > theirs.prio : mine.id > theirs.id;
