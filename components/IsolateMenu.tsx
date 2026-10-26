"use client";

// The New thread dialog's isolate menu (docs/architecture/worktrees.md), on the controls row beside the folder picker
// rather than a row of its own. Shared: the card works in the folder with the other cards, as every card always has.
// Worktree: it gets a git worktree of its own from the pool and lands its branch back on Done, on its own weft/*
// branch or one you pick from the repo's branches or name new. A dot and "Isolate?" suggest it when other cards are
// busy in the folder or the prompt is a big one.

import { useRef, useState } from "react";
import { timeAgo } from "@/lib/format";
import { matchBranches, useBranches, type Branch } from "@/lib/use-branches";
import { useEscape } from "@/lib/use-escape";
import { useMenuOpen } from "@/lib/use-menu-open";
import Icon from "./Icon";

export type IsolatePick = {
  on: boolean;
  suggest: boolean;
  // "" for the card's own weft/* branch.
  branch: string;
  onSet: (on: boolean) => void;
  onBranch: (name: string) => void;
};

function label({ on, suggest, branch }: Pick<IsolatePick, "on" | "suggest" | "branch">) {
  if (on) return branch || "Worktree";
  return suggest ? "Isolate?" : "Shared";
}

function tipFor(on: boolean, suggest: boolean) {
  if (on) return "Worktree: this card gets a git worktree of its own (~/.weft/worktrees), runs its tests and dev server there, and lands its branch on Done.";
  if (suggest) return "Other cards are busy in this folder, or this is a big change. Give it a worktree so their half-done edits can't break its tests, typecheck or dev server.";
  return "Shared: this card works in the folder with the other cards.";
}

export default function IsolateMenu({ cwd, on, suggest, branch, onSet, onBranch }: IsolatePick & { cwd: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useMenuOpen({ open, setOpen, menuRef: root });
  useEscape(open, () => setOpen(false));
  const pick = (name: string) => {
    onBranch(name);
    setOpen(false);
  };
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Isolation: ${label({ on, suggest, branch })}`}
        title={tipFor(on, suggest)}
        onClick={() => setOpen((v) => !v)}
        className={`relative flex items-center gap-1.5 rounded-md border py-1.5 pl-2 pr-1.5 text-[12px] font-medium ${
          on ? "border-accent/60 bg-accent/10 text-accent" : "border-line-strong text-muted hover:text-ink"
        }`}
      >
        <Icon name="branch" size={12} />
        <span className="max-w-[10rem] truncate">{label({ on, suggest, branch })}</span>
        <Icon name="chevronDown" size={12} />
        {suggest && !on && <span aria-hidden className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-warn" />}
      </button>
      {open && (
        <div role="dialog" aria-label="Isolation" className="absolute bottom-full left-0 z-40 mb-1 w-72 rounded-lg border border-line bg-panel p-2 shadow-lg">
          <ModeSwitch on={on} onSet={onSet} />
          <p className="px-1 pb-1 pt-1.5 text-[11px] leading-snug text-muted">{tipFor(on, false)}</p>
          {on && <BranchPicker cwd={cwd} branch={branch} onPick={pick} />}
        </div>
      )}
    </div>
  );
}

function ModeSwitch({ on, onSet }: { on: boolean; onSet: (on: boolean) => void }) {
  const seg = (active: boolean) => `flex-1 rounded py-1 text-[12px] font-medium ${active ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"}`;
  return (
    <div role="radiogroup" aria-label="Where it works" className="flex gap-0.5 rounded-md border border-line-strong p-0.5">
      <button type="button" role="radio" aria-checked={!on} onClick={() => onSet(false)} className={seg(!on)}>
        Shared
      </button>
      <button type="button" role="radio" aria-checked={on} onClick={() => onSet(true)} className={seg(on)}>
        Worktree
      </button>
    </div>
  );
}

const ROW = "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px]";

// Search the repo's branches, pick one (checked out as it is), or name a new one (made from HEAD). Enter takes the
// exact match, else the new name, else the first match.
function BranchPicker({ cwd, branch, onPick }: { cwd: string; branch: string; onPick: (name: string) => void }) {
  const [query, setQuery] = useState("");
  // Read once when the picker opens, for the branches' ages.
  const [now] = useState(() => Date.now());
  const branches = useBranches(cwd, true);
  const { matches, create } = matchBranches(branches ?? [], query);
  const free = matches.filter((b) => !b.worktree);
  const enter = () => {
    const exact = free.find((b) => b.name === query.trim());
    const name = exact?.name ?? create ?? free[0]?.name;
    if (name) onPick(name);
  };
  return (
    <div className="border-t border-line pt-2">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          enter();
        }}
        placeholder="Search branches or name a new one"
        aria-label="Branch"
        className="mb-1 w-full rounded-md border border-line-strong bg-transparent px-2 py-1 text-[12px] text-ink outline-none focus:border-accent/60"
      />
      <div role="listbox" aria-label="Branches" className="max-h-48 overflow-y-auto">
        {!query.trim() && (
          <BranchRow selected={!branch} onClick={() => onPick("")} name="Its own weft/… branch" note="new, from HEAD" />
        )}
        {create && <BranchRow selected={false} onClick={() => onPick(create)} name={`Create “${create}”`} note="from HEAD" add />}
        {branches === null && <p className="px-2 py-1 text-[12px] text-muted">Reading branches…</p>}
        {matches.map((b) => (
          <ExistingRow key={b.name} b={b} now={now} selected={b.name === branch} onPick={onPick} />
        ))}
        {branches !== null && !matches.length && !create && <p className="px-2 py-1 text-[12px] text-muted">No branch matches.</p>}
      </div>
    </div>
  );
}

function ExistingRow({ b, now, selected, onPick }: { b: Branch; now: number; selected: boolean; onPick: (name: string) => void }) {
  if (b.worktree) {
    return (
      <div role="option" aria-selected={false} aria-disabled title={`Checked out in ${b.worktree}: git won't check a branch out twice.`} className={`${ROW} cursor-not-allowed text-muted/60`}>
        <span className="w-[13px] shrink-0" />
        <span className="min-w-0 flex-1 truncate">{b.name}</span>
        <span className="shrink-0 text-[11px]">in use</span>
      </div>
    );
  }
  return <BranchRow selected={selected} onClick={() => onPick(b.name)} name={b.name} note={b.at ? timeAgo(b.at * 1000, now) : ""} />;
}

function BranchRow({ selected, onClick, name, note, add }: { selected: boolean; onClick: () => void; name: string; note: string; add?: boolean }) {
  return (
    <button type="button" role="option" aria-selected={selected} onClick={onClick} className={`${ROW} hover:bg-accent-soft ${add ? "text-accent" : "text-ink"}`}>
      <span className="flex w-[13px] shrink-0 justify-center text-accent">{selected ? <Icon name="check" size={13} /> : add ? <Icon name="plus" size={12} /> : null}</span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {note && <span className="shrink-0 text-[11px] text-muted">{note}</span>}
    </button>
  );
}
