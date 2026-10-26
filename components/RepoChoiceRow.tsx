"use client";

// One choice row in the repo picker's list: a pasted path, a repo on this Mac, or a GitHub repo to clone.
import type { Choice } from "@/lib/repo-picker";
import CloneProgress from "./CloneProgress";
import Icon, { Spinner } from "./Icon";
import { shortPath } from "./RepoPickerButton";

export default function RepoChoiceRow({
  choice,
  on,
  busy,
  value,
  home,
  onHover,
  onPick,
}: {
  choice: Choice;
  on: boolean;
  busy: string | null;
  value: string;
  home: string;
  onHover: () => void;
  onPick: () => void;
}) {
  const rowClass = `flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left ${on ? "bg-sunken" : ""}`;
  if (choice.kind === "path") {
    return (
      <button type="button" role="option" aria-selected={on} data-active={on} onMouseEnter={onHover} onClick={onPick} className={rowClass}>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{choice.path}</span>
        {busy === "path" ? <Spinner size={11} /> : <span className="text-[11px] text-faint">Use this folder</span>}
      </button>
    );
  }
  if (choice.kind === "local") {
    const r = choice.repo;
    const selected = r.path === value;
    return (
      <button type="button" role="option" aria-selected={on} data-active={on} onMouseEnter={onHover} onClick={onPick} className={rowClass}>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={`truncate text-[12.5px] ${selected ? "font-medium text-accent" : "text-ink"}`}>{r.name}</span>
            {r.branch && (
              <span className="flex shrink-0 items-center gap-1 font-mono text-[10.5px] text-muted">
                <Icon name="branch" size={10} />
                {r.branch}
              </span>
            )}
          </span>
          <span className="block truncate font-mono text-[11px] text-faint">
            {r.github ?? shortPath(r.path, home)}
          </span>
        </span>
        {selected && <Icon name="check" size={13} className="text-accent" />}
      </button>
    );
  }
  if (choice.kind === "github") {
    const r = choice.repo;
    const cloning = busy === r.fullName;
    return (
      <button type="button" role="option" aria-selected={on} data-active={on} disabled={Boolean(busy)} onMouseEnter={onHover} onClick={onPick} className={`${rowClass} disabled:opacity-70`}>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[12.5px] text-ink">{r.fullName}</span>
            {r.private && <span className="shrink-0 rounded border border-line-strong px-1 text-[10px] text-muted">private</span>}
          </span>
          {cloning ? (
            <span className="mt-1 block">
              <CloneProgress fullName={r.fullName} />
            </span>
          ) : (
            r.description && <span className="block truncate text-[11px] text-faint">{r.description}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted">
          {cloning ? (
            <>
              <Spinner size={11} /> Cloning…
            </>
          ) : (
            <>
              <Icon name="download" size={11} /> Clone to ~/dev
            </>
          )}
        </span>
      </button>
    );
  }
  return null;
}
